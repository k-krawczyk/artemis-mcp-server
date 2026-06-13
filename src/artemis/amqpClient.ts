import { createRequire } from 'node:module';
import type * as Rhea from 'rhea';
import type { AmqpError, Connection, ConnectionOptions, EventContext, Message } from 'rhea';
import type { AmqpConfig } from '../config.js';
import { AmqpOperationError } from '../errors.js';
import { logger } from '../logger.js';

// rhea ships ESM-shaped typings but is published as CommonJS; loading it through
// createRequire keeps both the types and the runtime resolution correct under
// NodeNext without bundling assumptions.
const nodeRequire = createRequire(import.meta.url);
const rhea = nodeRequire('rhea') as typeof Rhea;

export interface SendOptions {
  address: string;
  body: string;
  bodyType: 'text' | 'bytes';
  subject?: string;
  durable?: boolean;
  ttlMs?: number;
  properties?: Record<string, string | number | boolean>;
  messageId?: string;
}

export interface ReceivedMessage {
  messageId?: string;
  subject?: string;
  durable?: boolean;
  bodyEncoding: 'text' | 'base64';
  body: string;
  properties: Record<string, unknown>;
}

export class AmqpClient {
  private connection: Connection | undefined;
  private connecting: Promise<Connection> | undefined;
  private closing = false;

  constructor(private readonly config: AmqpConfig) {}

  async send(options: SendOptions): Promise<void> {
    const connection = await this.ensureConnection();
    const sender = connection.open_sender({ target: { address: options.address } });
    try {
      await this.withTimeout<void>('send', (resolve, reject) => {
        sender.on('sendable', () => {
          if (sender.sendable()) sender.send(buildMessage(options));
        });
        sender.on('accepted', () => resolve());
        sender.on('rejected', (ctx: EventContext) =>
          reject(new AmqpOperationError(`Broker rejected the message: ${deliveryError(ctx)}`)),
        );
        sender.on('released', () =>
          reject(new AmqpOperationError('Broker released the message without accepting it')),
        );
        sender.on('sender_error', (ctx: EventContext) =>
          reject(new AmqpOperationError(linkError(ctx, 'send'))),
        );
      });
    } finally {
      sender.close();
    }
  }

  browse(address: string, limit: number): Promise<ReceivedMessage[]> {
    return this.drainReceiver(address, limit, { distributionMode: 'copy', autoaccept: false });
  }

  consume(address: string, count: number): Promise<ReceivedMessage[]> {
    return this.drainReceiver(address, count, { distributionMode: 'move', autoaccept: true });
  }

  private async drainReceiver(
    address: string,
    limit: number,
    opts: { distributionMode: 'move' | 'copy'; autoaccept: boolean },
  ): Promise<ReceivedMessage[]> {
    const connection = await this.ensureConnection();
    const receiver = connection.open_receiver({
      source: { address, distribution_mode: opts.distributionMode },
      credit_window: 0,
      autoaccept: opts.autoaccept,
    });
    const messages: ReceivedMessage[] = [];

    try {
      await this.withTimeout<void>('receive', (resolve, reject) => {
        receiver.on('receiver_open', () => {
          receiver.add_credit(limit);
          receiver.drain_credit();
        });
        receiver.on('message', (ctx: EventContext) => {
          if (ctx.message) messages.push(parseMessage(ctx.message));
          if (messages.length >= limit) resolve();
        });
        receiver.on('receiver_drained', () => resolve());
        receiver.on('receiver_error', (ctx: EventContext) =>
          reject(new AmqpOperationError(linkError(ctx, 'receive'))),
        );
      });
    } finally {
      receiver.close();
    }
    return messages;
  }

  private ensureConnection(): Promise<Connection> {
    if (this.connection?.is_open()) return Promise.resolve(this.connection);
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<Connection>((resolve, reject) => {
      const base = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        password: this.config.password,
        reconnect: true,
        reconnect_limit: 10,
      };
      const options: ConnectionOptions =
        this.config.transport === 'tls'
          ? { ...base, transport: 'tls' }
          : { ...base, transport: 'tcp' };
      const connection = rhea.connect(options);

      const timer = setTimeout(() => {
        cleanup();
        connection.close();
        reject(new AmqpOperationError(`AMQP connection to ${this.config.host} timed out`));
      }, this.config.timeoutMs);

      const settleOpen = () => {
        cleanup();
        this.connection = connection;
        connection.on('disconnected', () => {
          if (!this.closing) logger.warn('AMQP connection dropped, will reconnect on next use');
        });
        resolve(connection);
      };
      const settleError = (ctx: EventContext) => {
        cleanup();
        reject(new AmqpOperationError(connectionError(ctx, this.config.host)));
      };
      const cleanup = () => {
        clearTimeout(timer);
        connection.removeListener('connection_open', settleOpen);
        connection.removeListener('connection_error', settleError);
        connection.removeListener('disconnected', settleError);
        this.connecting = undefined;
      };

      connection.on('connection_open', settleOpen);
      connection.on('connection_error', settleError);
      connection.on('disconnected', settleError);
    });

    return this.connecting;
  }

  private withTimeout<T>(
    label: string,
    executor: (resolve: (value: T) => void, reject: (reason: Error) => void) => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new AmqpOperationError(`AMQP ${label} operation timed out`));
      }, this.config.timeoutMs);
      executor(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (reason) => {
          clearTimeout(timer);
          reject(reason);
        },
      );
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    const connection = this.connection;
    if (!connection?.is_open()) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2_000);
      connection.once('connection_close', () => {
        clearTimeout(timer);
        resolve();
      });
      connection.close();
    });
  }
}

function buildMessage(options: SendOptions): Message {
  const message: Message = {
    body: options.bodyType === 'bytes' ? Buffer.from(options.body, 'base64') : options.body,
  };
  if (options.messageId) message.message_id = options.messageId;
  if (options.subject) message.subject = options.subject;
  if (options.durable !== undefined) message.durable = options.durable;
  if (options.ttlMs !== undefined) message.ttl = options.ttlMs;
  if (options.properties) message.application_properties = options.properties;
  return message;
}

function parseMessage(message: Message): ReceivedMessage {
  const body: unknown = message.body;
  let encoding: 'text' | 'base64' = 'text';
  let rendered: string;

  if (Buffer.isBuffer(body)) {
    encoding = 'base64';
    rendered = body.toString('base64');
  } else if (typeof body === 'string') {
    rendered = body;
  } else if (
    body &&
    typeof body === 'object' &&
    Buffer.isBuffer((body as { content?: unknown }).content)
  ) {
    encoding = 'base64';
    rendered = (body as { content: Buffer }).content.toString('base64');
  } else {
    rendered = body === undefined || body === null ? '' : JSON.stringify(body);
  }

  return {
    ...(message.message_id !== undefined ? { messageId: String(message.message_id) } : {}),
    ...(message.subject !== undefined ? { subject: message.subject } : {}),
    ...(message.durable !== undefined ? { durable: message.durable } : {}),
    bodyEncoding: encoding,
    body: rendered,
    properties: message.application_properties ?? {},
  };
}

function conditionOf(error: Error | AmqpError | undefined): string | undefined {
  if (error && typeof error === 'object' && 'condition' in error) {
    return error.condition;
  }
  return undefined;
}

function connectionError(ctx: EventContext, host: string): string {
  const condition = conditionOf(ctx.connection?.error);
  return condition
    ? `AMQP connection to ${host} failed: ${condition}`
    : `AMQP connection to ${host} failed`;
}

function linkError(ctx: EventContext, label: string): string {
  const condition =
    conditionOf(ctx.receiver?.error) ?? conditionOf(ctx.sender?.error) ?? 'unknown error';
  return `AMQP ${label} link error: ${condition}`;
}

function deliveryError(ctx: EventContext): string {
  const remoteState = ctx.delivery?.remote_state as { error?: { condition?: string } } | undefined;
  return remoteState?.error?.condition ?? 'no reason supplied';
}
