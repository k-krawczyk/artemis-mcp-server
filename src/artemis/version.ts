import { logger } from '../logger.js';
import { brokerObjectName, type JolokiaClient } from './jolokiaClient.js';

/**
 * Lowest Artemis version the tools are exercised against in CI. Older brokers may
 * still work but are unverified; the server only warns rather than refusing them.
 */
export const MIN_TESTED_ARTEMIS = '2.30.0';

export function isOlderThan(version: string, minimum: string): boolean {
  const parse = (value: string): number[] =>
    value.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const actual = parse(version);
  const floor = parse(minimum);
  for (let i = 0; i < 3; i++) {
    const a = actual[i] ?? 0;
    const b = floor[i] ?? 0;
    if (a !== b) return a < b;
  }
  return false;
}

/**
 * Best-effort: read the broker version, log it, and warn when it predates the
 * tested range. Never throws so a broker that is briefly unreachable at startup
 * does not bring the server down.
 */
export async function reportBrokerVersion(
  client: JolokiaClient,
  brokerName: string,
): Promise<void> {
  try {
    const version = await client.read<string>(brokerObjectName(brokerName), 'Version');
    logger.info(`connected to ActiveMQ Artemis ${version}`);
    if (isOlderThan(version, MIN_TESTED_ARTEMIS)) {
      logger.warn(
        `broker version ${version} is older than the tested minimum ${MIN_TESTED_ARTEMIS}; some tools may behave unexpectedly`,
      );
    }
  } catch {
    logger.warn('could not determine the broker version');
  }
}
