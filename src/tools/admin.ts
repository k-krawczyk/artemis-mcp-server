import { z } from 'zod';
import { resolveQueueMBean } from '../artemis/jolokiaClient.js';
import { confirmFlag, queueName, selector } from '../schemas.js';
import { defineTool, type Tool } from './types.js';

const purgeQueue = defineTool({
  name: 'purge_queue',
  title: 'Purge queue',
  description: 'Remove every message from a queue.',
  destructive: true,
  input: {
    queue: queueName,
    confirm: confirmFlag,
  },
  output: {
    queue: z.string(),
    removed: z.number(),
  },
  async handler(args, ctx) {
    const mbean = await resolveQueueMBean(ctx.jolokia, ctx.config.brokerName, args.queue);
    const removed = await ctx.jolokia.exec<number>(mbean, 'removeMessages(java.lang.String)', ['']);
    return { queue: args.queue, removed };
  },
});

const moveMessages = defineTool({
  name: 'move_messages',
  title: 'Move messages',
  description: 'Move messages from one queue to another, optionally filtered.',
  destructive: true,
  input: {
    queue: queueName,
    targetQueue: z.string().min(1).describe('Destination queue'),
    filter: selector.optional().describe('Only move messages matching this filter'),
    confirm: confirmFlag,
  },
  output: {
    queue: z.string(),
    targetQueue: z.string(),
    moved: z.number(),
  },
  async handler(args, ctx) {
    const mbean = await resolveQueueMBean(ctx.jolokia, ctx.config.brokerName, args.queue);
    const moved = await ctx.jolokia.exec<number>(
      mbean,
      'moveMessages(java.lang.String,java.lang.String)',
      [args.filter ?? '', args.targetQueue],
    );
    return { queue: args.queue, targetQueue: args.targetQueue, moved };
  },
});

const deleteMessages = defineTool({
  name: 'delete_messages',
  title: 'Delete messages',
  description:
    'Remove messages matching a filter. A filter is required to avoid purging the queue.',
  destructive: true,
  input: {
    queue: queueName,
    filter: selector,
    confirm: confirmFlag,
  },
  output: {
    queue: z.string(),
    filter: z.string(),
    removed: z.number(),
  },
  async handler(args, ctx) {
    const mbean = await resolveQueueMBean(ctx.jolokia, ctx.config.brokerName, args.queue);
    const removed = await ctx.jolokia.exec<number>(mbean, 'removeMessages(java.lang.String)', [
      args.filter,
    ]);
    return { queue: args.queue, filter: args.filter, removed };
  },
});

const retryDlq = defineTool({
  name: 'retry_dlq',
  title: 'Retry dead-letter messages',
  description: 'Resend the messages on a dead-letter queue to their original destination.',
  destructive: true,
  input: {
    queue: queueName,
    confirm: confirmFlag,
  },
  output: {
    queue: z.string(),
    retried: z.number(),
  },
  async handler(args, ctx) {
    const mbean = await resolveQueueMBean(ctx.jolokia, ctx.config.brokerName, args.queue);
    const retried = await ctx.jolokia.exec<number>(mbean, 'retryMessages');
    return { queue: args.queue, retried };
  },
});

export const adminTools: Tool[] = [purgeQueue, moveMessages, deleteMessages, retryDlq];
