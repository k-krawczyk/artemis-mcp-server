import { describe, expect, it } from 'vitest';
import { collectSecrets, loadConfig } from '../../src/config.js';

const base = {
  ARTEMIS_AMQP_URL: 'amqp://broker:5672',
  ARTEMIS_JOLOKIA_URL: 'http://broker:8161/console/jolokia',
  ARTEMIS_USER: 'admin',
  ARTEMIS_PASSWORD: 'sekret',
};

describe('loadConfig', () => {
  it('applies defaults for optional settings', () => {
    const config = loadConfig(base);
    expect(config.mode).toBe('read-only');
    expect(config.brokerName).toBe('0.0.0.0');
    expect(config.maxBrowse).toBe(200);
    expect(config.amqp).toMatchObject({ host: 'broker', port: 5672, transport: 'tcp' });
  });

  it('derives the tls transport and default port from amqps urls', () => {
    const config = loadConfig({ ...base, ARTEMIS_AMQP_URL: 'amqps://secure-broker' });
    expect(config.amqp.transport).toBe('tls');
    expect(config.amqp.port).toBe(5671);
    expect(config.amqp.host).toBe('secure-broker');
  });

  it('coerces numeric settings and trims a trailing slash from the jolokia url', () => {
    const config = loadConfig({
      ...base,
      ARTEMIS_JOLOKIA_URL: 'http://broker:8161/jolokia/',
      ARTEMIS_MAX_BROWSE: '50',
      ARTEMIS_MODE: 'admin',
    });
    expect(config.maxBrowse).toBe(50);
    expect(config.mode).toBe('admin');
    expect(config.jolokia.url).toBe('http://broker:8161/jolokia');
  });

  it('treats empty values as unset and applies defaults', () => {
    const config = loadConfig({ ...base, ARTEMIS_MODE: '', ARTEMIS_MAX_BROWSE: '' });
    expect(config.mode).toBe('read-only');
    expect(config.maxBrowse).toBe(200);
  });

  it('rejects missing required settings', () => {
    expect(() => loadConfig({})).toThrow(/Invalid configuration/);
  });

  it('rejects an unknown mode', () => {
    expect(() => loadConfig({ ...base, ARTEMIS_MODE: 'superuser' })).toThrow(/ARTEMIS_MODE/);
  });

  it('rejects a non-amqp scheme', () => {
    expect(() => loadConfig({ ...base, ARTEMIS_AMQP_URL: 'http://broker' })).toThrow(/amqp/);
  });

  it('collects credentials so they can be redacted', () => {
    const config = loadConfig(base);
    expect(collectSecrets(config)).toContain('sekret');
  });
});
