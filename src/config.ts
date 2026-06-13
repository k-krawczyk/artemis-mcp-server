import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

const modeSchema = z.enum(['read-only', 'admin']);

const envSchema = z.object({
  ARTEMIS_AMQP_URL: z.string().url(),
  ARTEMIS_JOLOKIA_URL: z.string().url(),
  ARTEMIS_USER: z.string().min(1),
  ARTEMIS_PASSWORD: z.string().min(1),
  ARTEMIS_BROKER_NAME: z.string().min(1).default('0.0.0.0'),
  ARTEMIS_MODE: modeSchema.default('read-only'),
  ARTEMIS_MAX_BROWSE: z.coerce.number().int().positive().max(10_000).default(200),
  ARTEMIS_JOLOKIA_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  ARTEMIS_AMQP_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
});

export type Mode = z.infer<typeof modeSchema>;

export interface AmqpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  transport: 'tcp' | 'tls';
  timeoutMs: number;
}

export interface JolokiaConfig {
  url: string;
  username: string;
  password: string;
  timeoutMs: number;
}

export interface Config {
  mode: Mode;
  brokerName: string;
  maxBrowse: number;
  amqp: AmqpConfig;
  jolokia: JolokiaConfig;
}

class ConfigError extends Error {}

function parseAmqpUrl(raw: string): Pick<AmqpConfig, 'host' | 'port' | 'transport'> {
  const url = new URL(raw);
  const secure = url.protocol === 'amqps:';
  if (url.protocol !== 'amqp:' && url.protocol !== 'amqps:') {
    throw new ConfigError(`ARTEMIS_AMQP_URL must use amqp:// or amqps://, got ${url.protocol}`);
  }
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : secure ? 5671 : 5672,
    transport: secure ? 'tls' : 'tcp',
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // stdout is reserved for the MCP protocol, so dotenv must not print to it.
  loadEnv({ quiet: true });
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Invalid configuration:\n${issues}`);
  }

  const e = parsed.data;
  const amqp = parseAmqpUrl(e.ARTEMIS_AMQP_URL);

  return {
    mode: e.ARTEMIS_MODE,
    brokerName: e.ARTEMIS_BROKER_NAME,
    maxBrowse: e.ARTEMIS_MAX_BROWSE,
    amqp: {
      ...amqp,
      username: e.ARTEMIS_USER,
      password: e.ARTEMIS_PASSWORD,
      timeoutMs: e.ARTEMIS_AMQP_TIMEOUT_MS,
    },
    jolokia: {
      url: e.ARTEMIS_JOLOKIA_URL.replace(/\/+$/, ''),
      username: e.ARTEMIS_USER,
      password: e.ARTEMIS_PASSWORD,
      timeoutMs: e.ARTEMIS_JOLOKIA_TIMEOUT_MS,
    },
  };
}

export function collectSecrets(config: Config): string[] {
  return [config.amqp.password, config.jolokia.password].filter((s) => s.length > 0);
}
