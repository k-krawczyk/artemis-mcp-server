import { z } from 'zod';
import { brokerObjectName, listQueueNames, resolveQueueMBean } from '../artemis/jolokiaClient.js';
import { queueName } from '../schemas.js';
import { asNumber, asString, parseJsonArray } from './coerce.js';
import { defineTool, type Tool } from './types.js';

const getQueueStats = defineTool({
  name: 'get_queue_stats',
  title: 'Get queue stats',
  description: 'Return runtime counters for a queue.',
  input: {
    queue: queueName,
  },
  output: {
    queue: z.string(),
    messageCount: z.number().nullable(),
    messagesAdded: z.number().nullable(),
    messagesAcknowledged: z.number().nullable(),
    messagesExpired: z.number().nullable(),
    deliveringCount: z.number().nullable(),
    scheduledCount: z.number().nullable(),
    consumerCount: z.number().nullable(),
  },
  async handler(args, ctx) {
    const mbean = await resolveQueueMBean(ctx.jolokia, ctx.config.brokerName, args.queue);
    const attrs = await ctx.jolokia.read<Record<string, unknown>>(mbean);
    return {
      queue: args.queue,
      messageCount: asNumber(attrs.MessageCount),
      messagesAdded: asNumber(attrs.MessagesAdded),
      messagesAcknowledged: asNumber(attrs.MessagesAcknowledged),
      messagesExpired: asNumber(attrs.MessagesExpired),
      deliveringCount: asNumber(attrs.DeliveringCount),
      scheduledCount: asNumber(attrs.ScheduledCount),
      consumerCount: asNumber(attrs.ConsumerCount),
    };
  },
});

const getBrokerOverview = defineTool({
  name: 'get_broker_overview',
  title: 'Get broker overview',
  description: 'Return high level broker status and counts.',
  input: {},
  output: {
    version: z.string().nullable(),
    uptime: z.string().nullable(),
    started: z.boolean().nullable(),
    addressMemoryUsage: z.number().nullable(),
    totalConnectionCount: z.number().nullable(),
    totalConsumerCount: z.number().nullable(),
    totalMessageCount: z.number().nullable(),
    queueCount: z.number(),
    addressCount: z.number(),
  },
  async handler(_args, ctx) {
    const broker = brokerObjectName(ctx.config.brokerName);
    const attrs = await ctx.jolokia.read<Record<string, unknown>>(broker);
    const queues = await listQueueNames(ctx.jolokia, ctx.config.brokerName);
    return {
      version: asString(attrs.Version),
      uptime: asString(attrs.Uptime),
      started: typeof attrs.Started === 'boolean' ? attrs.Started : null,
      addressMemoryUsage: asNumber(attrs.AddressMemoryUsage),
      totalConnectionCount: asNumber(attrs.TotalConnectionCount),
      totalConsumerCount: asNumber(attrs.TotalConsumerCount),
      totalMessageCount: asNumber(attrs.TotalMessageCount),
      queueCount: queues.length,
      addressCount: asNumber(attrs.AddressCount) ?? 0,
    };
  },
});

const listConsumers = defineTool({
  name: 'list_consumers',
  title: 'List consumers',
  description: 'List the consumers currently attached to the broker.',
  input: {},
  output: {
    count: z.number(),
    consumers: z.array(z.record(z.string(), z.unknown())),
  },
  async handler(_args, ctx) {
    const raw = await ctx.jolokia.exec(
      brokerObjectName(ctx.config.brokerName),
      'listAllConsumersAsJSON',
    );
    const consumers = parseJsonArray(raw);
    return { count: consumers.length, consumers };
  },
});

const listConnections = defineTool({
  name: 'list_connections',
  title: 'List connections',
  description: 'List the connections currently open to the broker.',
  input: {},
  output: {
    count: z.number(),
    connections: z.array(z.record(z.string(), z.unknown())),
  },
  async handler(_args, ctx) {
    const raw = await ctx.jolokia.exec(
      brokerObjectName(ctx.config.brokerName),
      'listConnectionsAsJSON',
    );
    const connections = parseJsonArray(raw);
    return { count: connections.length, connections };
  },
});

export const monitoringTools: Tool[] = [
  getQueueStats,
  getBrokerOverview,
  listConsumers,
  listConnections,
];
