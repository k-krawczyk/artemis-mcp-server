import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AmqpClient } from '../../src/artemis/amqpClient.js';
import { discoverBrokerName, JolokiaClient } from '../../src/artemis/jolokiaClient.js';
import type { Config } from '../../src/config.js';
import { runTool } from '../../src/server.js';
import { adminTools } from '../../src/tools/admin.js';
import { managementTools } from '../../src/tools/management.js';
import { messagingTools } from '../../src/tools/messaging.js';
import { monitoringTools } from '../../src/tools/monitoring.js';
import type { Tool, ToolContext } from '../../src/tools/types.js';

const USER = 'artemis';
const PASSWORD = 'artemis';

const allTools = [...messagingTools, ...managementTools, ...monitoringTools, ...adminTools];
const tool = (name: string): Tool => {
  const found = allTools.find((t) => t.name === name);
  if (!found) throw new Error(`unknown tool ${name}`);
  return found;
};

async function call(ctx: ToolContext, name: string, args: Record<string, unknown>) {
  const result = await runTool(tool(name), args, ctx);
  if (result.isError) {
    const text = (result.content[0] as { text: string }).text;
    throw new Error(`${name} failed: ${text}`);
  }
  return result.structuredContent as Record<string, unknown>;
}

describe('artemis broker integration', () => {
  let container: StartedTestContainer;
  let ctx: ToolContext;
  let amqp: AmqpClient;

  beforeAll(async () => {
    const image = process.env.ARTEMIS_IMAGE ?? 'apache/activemq-artemis:latest-alpine';
    container = await new GenericContainer(image)
      .withEnvironment({
        ARTEMIS_USER: USER,
        ARTEMIS_PASSWORD: PASSWORD,
        EXTRA_ARGS: '--http-host 0.0.0.0 --relax-jolokia',
      })
      .withExposedPorts(5672, 8161)
      // AMQ241004 is logged once the console (and the Jolokia endpoint this
      // server depends on) is reachable, which is later than "Server is active".
      .withWaitStrategy(Wait.forLogMessage(/AMQ241004/, 1))
      .withStartupTimeout(180_000)
      .start();

    const host = container.getHost();
    const jolokia = new JolokiaClient({
      url: `http://${host}:${container.getMappedPort(8161)}/console/jolokia`,
      username: USER,
      password: PASSWORD,
      timeoutMs: 10_000,
    });
    amqp = new AmqpClient({
      host,
      port: container.getMappedPort(5672),
      username: USER,
      password: PASSWORD,
      transport: 'tcp',
      timeoutMs: 15_000,
    });

    const brokerName = await discoverBrokerName(jolokia);
    const config: Config = {
      mode: 'admin',
      brokerName,
      maxBrowse: 200,
      amqp: {
        host,
        port: container.getMappedPort(5672),
        username: USER,
        password: PASSWORD,
        transport: 'tcp',
        timeoutMs: 15_000,
      },
      jolokia: {
        url: `http://${host}:${container.getMappedPort(8161)}/console/jolokia`,
        username: USER,
        password: PASSWORD,
        timeoutMs: 10_000,
      },
    };
    ctx = { config, jolokia, amqp };
  });

  afterAll(async () => {
    await amqp?.close();
    await container?.stop();
  });

  it('creates queues and lists them', async () => {
    await call(ctx, 'create_queue', { name: 'orders', routingType: 'anycast' });
    await call(ctx, 'create_queue', { name: 'archive', routingType: 'anycast' });
    const listed = await call(ctx, 'list_queues', {});
    expect(listed.queues).toContain('orders');
    expect(listed.queues).toContain('archive');
  });

  it('lists addresses', async () => {
    const listed = await call(ctx, 'list_addresses', {});
    expect(listed.addresses).toContain('orders');
  });

  it('reports queue configuration', async () => {
    const info = await call(ctx, 'get_queue_info', { queue: 'orders' });
    expect(info.address).toBe('orders');
    expect(info.routingType).toBe('ANYCAST');
    expect(info.durable).toBe(true);
  });

  it('sends a message and reflects it in the queue stats', async () => {
    await call(ctx, 'send_message', {
      address: 'orders',
      body: 'hello',
      properties: { priority: 9 },
    });
    const stats = await call(ctx, 'get_queue_stats', { queue: 'orders' });
    expect(stats.messageCount).toBe(1);
  });

  it('browses without removing the message', async () => {
    const browsed = await call(ctx, 'browse_messages', { queue: 'orders', limit: 10 });
    expect(browsed.count).toBe(1);
    const messages = browsed.messages as Array<{
      body: string;
      properties: Record<string, unknown>;
    }>;
    expect(messages[0]?.body).toBe('hello');
    expect(messages[0]?.properties.priority).toBe(9);

    const stats = await call(ctx, 'get_queue_stats', { queue: 'orders' });
    expect(stats.messageCount).toBe(1);
  });

  it('lists consumers and connections', async () => {
    const consumers = await call(ctx, 'list_consumers', {});
    expect(typeof consumers.count).toBe('number');
    const connections = await call(ctx, 'list_connections', {});
    expect(typeof connections.count).toBe('number');
  });

  it('consumes and removes the message', async () => {
    const consumed = await call(ctx, 'consume_message', { queue: 'orders', count: 5 });
    expect(consumed.count).toBe(1);
    const stats = await call(ctx, 'get_queue_stats', { queue: 'orders' });
    expect(stats.messageCount).toBe(0);
  });

  it('moves messages between queues', async () => {
    await call(ctx, 'send_message', { address: 'orders', body: 'a' });
    await call(ctx, 'send_message', { address: 'orders', body: 'b' });
    const moved = await call(ctx, 'move_messages', {
      queue: 'orders',
      targetQueue: 'archive',
      confirm: true,
    });
    expect(moved.moved).toBe(2);
    expect((await call(ctx, 'get_queue_stats', { queue: 'orders' })).messageCount).toBe(0);
    expect((await call(ctx, 'get_queue_stats', { queue: 'archive' })).messageCount).toBe(2);
    await call(ctx, 'purge_queue', { queue: 'archive', confirm: true });
  });

  it('deletes messages matching a filter', async () => {
    await call(ctx, 'send_message', { address: 'orders', body: 'keep' });
    await call(ctx, 'send_message', {
      address: 'orders',
      body: 'drop',
      properties: { batch: 'old' },
    });
    const deleted = await call(ctx, 'delete_messages', {
      queue: 'orders',
      filter: "batch = 'old'",
      confirm: true,
    });
    expect(deleted.removed).toBe(1);
    expect((await call(ctx, 'get_queue_stats', { queue: 'orders' })).messageCount).toBe(1);
    await call(ctx, 'purge_queue', { queue: 'orders', confirm: true });
  });

  it('retries dead-letter messages', async () => {
    await call(ctx, 'send_message', { address: 'DLQ', body: 'failed' });
    const retried = await call(ctx, 'retry_dlq', { queue: 'DLQ', confirm: true });
    expect(typeof retried.retried).toBe('number');
    await call(ctx, 'purge_queue', { queue: 'DLQ', confirm: true });
  });

  it('refuses to purge without confirm', async () => {
    const result = await runTool(tool('purge_queue'), { queue: 'orders' }, ctx);
    expect(result.isError).toBe(true);
  });

  it('purges messages when confirmed', async () => {
    await call(ctx, 'send_message', { address: 'orders', body: 'one' });
    await call(ctx, 'send_message', { address: 'orders', body: 'two' });
    const purged = await call(ctx, 'purge_queue', { queue: 'orders', confirm: true });
    expect(purged.removed).toBe(2);
  });

  it('reports the broker overview', async () => {
    const overview = await call(ctx, 'get_broker_overview', {});
    expect(typeof overview.version).toBe('string');
    expect(overview.queueCount).toBeGreaterThan(0);
  });

  it('deletes the queues', async () => {
    await call(ctx, 'delete_queue', { name: 'orders', confirm: true });
    await call(ctx, 'delete_queue', { name: 'archive', confirm: true });
    const listed = await call(ctx, 'list_queues', {});
    expect(listed.queues).not.toContain('orders');
    expect(listed.queues).not.toContain('archive');
  });
});
