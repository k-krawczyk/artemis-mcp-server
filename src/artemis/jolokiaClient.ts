import type { JolokiaConfig } from '../config.js';
import { JolokiaError } from '../errors.js';
import { logger } from '../logger.js';

interface JolokiaResponse {
  status: number;
  value?: unknown;
  error?: string;
  error_type?: string;
}

type JolokiaRequest =
  | { type: 'read'; mbean: string; attribute?: string | string[] }
  | { type: 'exec'; mbean: string; operation: string; arguments: unknown[] }
  | { type: 'search'; mbean: string };

export class JolokiaClient {
  private readonly auth: string;

  constructor(private readonly config: JolokiaConfig) {
    this.auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
  }

  read<T = unknown>(mbean: string, attribute?: string | string[]): Promise<T> {
    return this.post<T>({ type: 'read', mbean, ...(attribute ? { attribute } : {}) });
  }

  exec<T = unknown>(mbean: string, operation: string, args: unknown[] = []): Promise<T> {
    return this.post<T>({ type: 'exec', mbean, operation, arguments: args });
  }

  search(pattern: string): Promise<string[]> {
    return this.post<string[]>({ type: 'search', mbean: pattern });
  }

  private async post<T>(request: JolokiaRequest): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let res: Response;
    try {
      res = await fetch(this.config.url, {
        method: 'POST',
        headers: {
          authorization: `Basic ${this.auth}`,
          'content-type': 'application/json',
          // Jolokia honours this header to keep stack traces out of responses.
          'x-jolokia-no-stacktrace': 'true',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new JolokiaError(`Jolokia request timed out after ${this.config.timeoutMs}ms`);
      }
      logger.error('jolokia transport failure', err);
      throw new JolokiaError(`Cannot reach Jolokia at ${this.config.url}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new JolokiaError(httpMessage(res.status, this.config.url), res.status);
    }

    const body = (await res.json()) as JolokiaResponse;
    if (body.status !== 200) {
      throw new JolokiaError(operationMessage(body), body.status);
    }
    return body.value as T;
  }
}

function httpMessage(status: number, url: string): string {
  switch (status) {
    case 401:
      return 'Jolokia authentication failed; check ARTEMIS_USER and ARTEMIS_PASSWORD';
    case 403:
      return 'Jolokia access denied for the configured user';
    case 404:
      return `Jolokia endpoint not found at ${url}; is the Artemis console enabled?`;
    default:
      return `Jolokia request failed with HTTP ${status}`;
  }
}

function operationMessage(body: JolokiaResponse): string {
  const detail = body.error?.replace(/\s+/g, ' ').trim();
  if (detail) return detail;
  return `Jolokia returned status ${body.status}`;
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function brokerObjectName(broker: string): string {
  return `org.apache.activemq.artemis:broker=${quote(broker)}`;
}

export function addressObjectName(broker: string, address: string): string {
  return `${brokerObjectName(broker)},component=addresses,address=${quote(address)}`;
}

export function queueSearchPattern(broker: string, queue: string): string {
  return `${brokerObjectName(broker)},component=addresses,address=*,subcomponent=queues,routing-type=*,queue=${quote(queue)}`;
}

export async function discoverBrokerName(client: JolokiaClient): Promise<string> {
  const matches = await client.search('org.apache.activemq.artemis:broker=*');
  const first = matches[0];
  const name = first ? /broker="([^"]+)"/.exec(first)?.[1] : undefined;
  if (!name) {
    throw new JolokiaError('No Artemis broker MBean found at the Jolokia endpoint');
  }
  return name;
}

export async function resolveQueueMBean(
  client: JolokiaClient,
  broker: string,
  queue: string,
): Promise<string> {
  const matches = await client.search(queueSearchPattern(broker, queue));
  const mbean = matches[0];
  if (!mbean) {
    throw new JolokiaError(`Queue not found: ${queue}`, 404);
  }
  return mbean;
}
