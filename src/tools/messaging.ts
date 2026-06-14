import { z } from 'zod';
import { queueName, receivedMessage } from '../schemas.js';
import { defineTool, type Tool } from './types.js';

function sourceAddress(queue: string, address?: string): string {
  return address && address !== queue ? `${address}::${queue}` : queue;
}

const sendMessage = defineTool({
  name: 'send_message',
  title: 'Send message',
  description: 'Send a single AMQP message to an address or queue.',
  write: true,
  input: {
    address: z.string().min(1).describe('Target address or queue'),
    body: z.string().describe('Message body. Base64-encoded when bodyType is "bytes"'),
    bodyType: z.enum(['text', 'bytes']).default('text'),
    subject: z.string().optional(),
    durable: z.boolean().default(true),
    ttlMs: z.number().int().positive().optional().describe('Time to live in milliseconds'),
    messageId: z.string().optional(),
    properties: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional()
      .describe('Application properties attached to the message'),
  },
  output: {
    address: z.string(),
    accepted: z.boolean(),
  },
  async handler(args, ctx) {
    await ctx.amqp.send({
      address: args.address,
      body: args.body,
      bodyType: args.bodyType,
      durable: args.durable,
      ...(args.subject !== undefined ? { subject: args.subject } : {}),
      ...(args.ttlMs !== undefined ? { ttlMs: args.ttlMs } : {}),
      ...(args.messageId !== undefined ? { messageId: args.messageId } : {}),
      ...(args.properties !== undefined ? { properties: args.properties } : {}),
    });
    return { address: args.address, accepted: true };
  },
});

const browseMessages = defineTool({
  name: 'browse_messages',
  title: 'Browse messages',
  description: 'Read messages from a queue without removing them.',
  input: {
    queue: queueName,
    address: z.string().min(1).optional().describe('Address, when it differs from the queue name'),
    limit: z.number().int().positive().default(10).describe('Maximum number of messages to read'),
  },
  output: {
    queue: z.string(),
    count: z.number(),
    messages: z.array(receivedMessage),
  },
  async handler(args, ctx) {
    const limit = Math.min(args.limit, ctx.config.maxBrowse);
    const messages = await ctx.amqp.browse(sourceAddress(args.queue, args.address), limit);
    return { queue: args.queue, count: messages.length, messages };
  },
});

const consumeMessage = defineTool({
  name: 'consume_message',
  title: 'Consume messages',
  description: 'Receive and remove messages from a queue.',
  write: true,
  input: {
    queue: queueName,
    address: z.string().min(1).optional().describe('Address, when it differs from the queue name'),
    count: z.number().int().positive().default(1).describe('Number of messages to consume'),
  },
  output: {
    queue: z.string(),
    count: z.number(),
    messages: z.array(receivedMessage),
  },
  async handler(args, ctx) {
    const count = Math.min(args.count, ctx.config.maxBrowse);
    const messages = await ctx.amqp.consume(sourceAddress(args.queue, args.address), count);
    return { queue: args.queue, count: messages.length, messages };
  },
});

export const messagingTools: Tool[] = [sendMessage, browseMessages, consumeMessage];
