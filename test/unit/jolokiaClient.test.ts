import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addressObjectName,
  brokerObjectName,
  JolokiaClient,
  listAddressNames,
  listQueueNames,
  queueSearchPattern,
  resolveQueueMBean,
} from '../../src/artemis/jolokiaClient.js';
import { JolokiaError } from '../../src/errors.js';

const config = {
  url: 'http://broker:8161/jolokia',
  username: 'admin',
  password: 'secret',
  timeoutMs: 1000,
};

function mockFetch(response: { ok: boolean; status: number; body?: unknown; reject?: Error }) {
  return vi.fn(() => {
    if (response.reject) return Promise.reject(response.reject);
    return Promise.resolve({
      ok: response.ok,
      status: response.status,
      json: () => Promise.resolve(response.body),
    } as Response);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('JolokiaClient transport', () => {
  it('returns the value of a successful response', async () => {
    const fetchMock = mockFetch({ ok: true, status: 200, body: { status: 200, value: [42] } });
    vi.stubGlobal('fetch', fetchMock);
    const client = new JolokiaClient(config);
    await expect(client.read('mbean', 'MessageCount')).resolves.toEqual([42]);
  });

  it('sends an exec request with the operation and arguments', async () => {
    const fetchMock = mockFetch({ ok: true, status: 200, body: { status: 200, value: 7 } });
    vi.stubGlobal('fetch', fetchMock);
    const client = new JolokiaClient(config);
    await client.exec('mbean', 'removeMessages(java.lang.String)', ['']);
    const sentBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as Record<
      string,
      unknown
    >;
    expect(sentBody).toMatchObject({
      type: 'exec',
      mbean: 'mbean',
      operation: 'removeMessages(java.lang.String)',
      arguments: [''],
    });
  });

  it.each([
    [401, /authentication failed/i],
    [403, /access denied/i],
    [404, /not found/i],
    [500, /HTTP 500/],
  ])('maps http %i to a readable error', async (status, matcher) => {
    vi.stubGlobal('fetch', mockFetch({ ok: false, status }));
    const client = new JolokiaClient(config);
    await expect(client.read('mbean')).rejects.toThrow(matcher);
  });

  it('maps a non-200 jolokia status to the operation error message', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        ok: true,
        status: 200,
        body: { status: 404, error: 'javax.management.InstanceNotFoundException: missing' },
      }),
    );
    const client = new JolokiaClient(config);
    await expect(client.read('mbean')).rejects.toThrow(/InstanceNotFoundException/);
  });

  it('reports a timeout when the request is aborted', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    vi.stubGlobal('fetch', mockFetch({ ok: false, status: 0, reject: abort }));
    const client = new JolokiaClient(config);
    await expect(client.read('mbean')).rejects.toThrow(/timed out/);
  });
});

describe('ObjectName helpers', () => {
  it('quotes the broker name', () => {
    expect(brokerObjectName('0.0.0.0')).toBe('org.apache.activemq.artemis:broker="0.0.0.0"');
  });

  it('escapes embedded quotes', () => {
    expect(addressObjectName('0.0.0.0', 'odd"name')).toContain('address="odd\\"name"');
  });

  it('builds a wildcard search pattern for a queue', () => {
    const pattern = queueSearchPattern('0.0.0.0', 'orders');
    expect(pattern).toContain('address=*');
    expect(pattern).toContain('routing-type=*');
    expect(pattern).toContain('queue="orders"');
  });
});

describe('listQueueNames', () => {
  it('uses the routing-type overload by default', async () => {
    const exec = vi.fn().mockResolvedValue(['orders']);
    const client = { exec } as unknown as JolokiaClient;
    await expect(listQueueNames(client, '0.0.0.0')).resolves.toEqual(['orders']);
    expect(exec).toHaveBeenCalledWith(expect.any(String), 'getQueueNames', ['']);
  });

  it('falls back to the no-argument form for older brokers', async () => {
    const exec = vi
      .fn()
      .mockRejectedValueOnce(new JolokiaError('Invalid number of operation arguments'))
      .mockResolvedValueOnce(['legacy']);
    const client = { exec } as unknown as JolokiaClient;
    await expect(listQueueNames(client, '0.0.0.0')).resolves.toEqual(['legacy']);
    expect(exec).toHaveBeenNthCalledWith(2, expect.any(String), 'getQueueNames', []);
  });
});

describe('listAddressNames', () => {
  it('reads the AddressNames attribute by default', async () => {
    const read = vi.fn().mockResolvedValue(['orders']);
    const client = { read } as unknown as JolokiaClient;
    await expect(listAddressNames(client, '0.0.0.0')).resolves.toEqual(['orders']);
  });

  it('falls back to the getAddressNames operation for older brokers', async () => {
    const read = vi.fn().mockRejectedValue(new JolokiaError('No attribute AddressNames'));
    const exec = vi.fn().mockResolvedValue(['legacy']);
    const client = { read, exec } as unknown as JolokiaClient;
    await expect(listAddressNames(client, '0.0.0.0')).resolves.toEqual(['legacy']);
  });
});

describe('resolveQueueMBean', () => {
  it('returns the first matching mbean', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ ok: true, status: 200, body: { status: 200, value: ['mbean:one'] } }),
    );
    const client = new JolokiaClient(config);
    await expect(resolveQueueMBean(client, '0.0.0.0', 'orders')).resolves.toBe('mbean:one');
  });

  it('throws when the queue cannot be found', async () => {
    vi.stubGlobal('fetch', mockFetch({ ok: true, status: 200, body: { status: 200, value: [] } }));
    const client = new JolokiaClient(config);
    await expect(resolveQueueMBean(client, '0.0.0.0', 'ghost')).rejects.toBeInstanceOf(
      JolokiaError,
    );
  });
});
