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
    container = await new GenericContainer('apache/activemq-artemis:latest-alpine')
      .withEnvironment({
        ARTEMIS_USER: USER,
        ARTEMIS_PASSWORD: PASSWORD,
        EXTRA_ARGS: '--http-host 0.0.0.0 --relax-jolokia',
      })
      .withExposedPorts(5672, 8161)
      .withWaitStrategy(Wait.forLogMessage(/Server is now live/, 1))
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

  it('creates a queue and lists it', async () => {
    await call(ctx, 'create_queue', { name: 'orders', routingType: 'anycast' });
    const listed = await call(ctx, 'list_queues', {});
    expect(listed.queues).toContain('orders');
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

  it('consumes and removes the message', async () => {
    const consumed = await call(ctx, 'consume_message', { queue: 'orders', count: 5 });
    expect(consumed.count).toBe(1);
    const stats = await call(ctx, 'get_queue_stats', { queue: 'orders' });
    expect(stats.messageCount).toBe(0);
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

  it('deletes the queue', async () => {
    await call(ctx, 'delete_queue', { name: 'orders', confirm: true });
    const listed = await call(ctx, 'list_queues', {});
    expect(listed.queues).not.toContain('orders');
  });
});
