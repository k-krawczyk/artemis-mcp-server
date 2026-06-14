import { z } from 'zod';
import {
  brokerObjectName,
  listAddressNames,
  listQueueNames,
  resolveQueueMBean,
} from '../artemis/jolokiaClient.js';
import { addressName, confirmFlag, queueName, routingType, selector } from '../schemas.js';
import { asBoolean, asNumber, asString } from './coerce.js';
import { defineTool, type Tool } from './types.js';

const listQueues = defineTool({
  name: 'list_queues',
  title: 'List queues',
  description: 'List the names of all queues on the broker.',
  input: {},
  output: {
    count: z.number(),
    queues: z.array(z.string()),
  },
  async handler(_args, ctx) {
    const queues = await listQueueNames(ctx.jolokia, ctx.config.brokerName);
    return { count: queues.length, queues };
  },
});

const listAddresses = defineTool({
  name: 'list_addresses',
  title: 'List addresses',
  description: 'List the names of all addresses on the broker.',
  input: {},
  output: {
    count: z.number(),
    addresses: z.array(z.string()),
  },
  async handler(_args, ctx) {
    const addresses = await listAddressNames(ctx.jolokia, ctx.config.brokerName);
    return { count: addresses.length, addresses };
  },
});

const createQueue = defineTool({
  name: 'create_queue',
  title: 'Create queue',
  description: 'Create a queue, optionally creating its address.',
  write: true,
  input: {
    name: queueName,
    address: addressName.optional().describe('Address to bind to; defaults to the queue name'),
    routingType: routingType.default('anycast'),
    durable: z.boolean().default(true),
    filter: selector.optional(),
    maxConsumers: z.number().int().default(-1).describe('-1 means unlimited consumers'),
    autoCreateAddress: z.boolean().default(true),
  },
  output: {
    name: z.string(),
    address: z.string(),
    routingType: z.string(),
  },
  async handler(args, ctx) {
    const address = args.address ?? args.name;
    await ctx.jolokia.exec(
      brokerObjectName(ctx.config.brokerName),
      'createQueue(java.lang.String,java.lang.String,java.lang.String,java.lang.String,boolean,int,boolean,boolean)',
      [
        address,
        args.routingType.toUpperCase(),
        args.name,
        args.filter ?? null,
        args.durable,
        args.maxConsumers,
        false,
        args.autoCreateAddress,
      ],
    );
    return { name: args.name, address, routingType: args.routingType };
  },
});

const deleteQueue = defineTool({
  name: 'delete_queue',
  title: 'Delete queue',
  description: 'Destroy a queue.',
  destructive: true,
  input: {
    name: queueName,
    removeConsumers: z.boolean().default(false),
    autoDeleteAddress: z.boolean().default(false),
    confirm: confirmFlag,
  },
  output: {
    name: z.string(),
    deleted: z.boolean(),
  },
  async handler(args, ctx) {
    await ctx.jolokia.exec(
      brokerObjectName(ctx.config.brokerName),
      'destroyQueue(java.lang.String,boolean,boolean)',
      [args.name, args.removeConsumers, args.autoDeleteAddress],
    );
    return { name: args.name, deleted: true };
  },
});

const getQueueInfo = defineTool({
  name: 'get_queue_info',
  title: 'Get queue info',
  description: 'Return the configuration of a queue.',
  input: {
    queue: queueName,
  },
  output: {
    queue: z.string(),
    address: z.string().nullable(),
    routingType: z.string().nullable(),
    durable: z.boolean().nullable(),
    filter: z.string().nullable(),
    maxConsumers: z.number().nullable(),
    temporary: z.boolean().nullable(),
  },
  async handler(args, ctx) {
    const mbean = await resolveQueueMBean(ctx.jolokia, ctx.config.brokerName, args.queue);
    const attrs = await ctx.jolokia.read<Record<string, unknown>>(mbean);
    return {
      queue: args.queue,
      address: asString(attrs.Address),
      routingType: asString(attrs.RoutingType),
      durable: asBoolean(attrs.Durable),
      filter: asString(attrs.FilterString ?? attrs.Filter),
      maxConsumers: asNumber(attrs.MaxConsumers),
      temporary: asBoolean(attrs.Temporary),
    };
  },
});

export const managementTools: Tool[] = [
  listQueues,
  listAddresses,
  createQueue,
  deleteQueue,
  getQueueInfo,
];
