import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { reportBrokerVersion } from './artemis/version.js';
import { collectSecrets, loadConfig, type Config } from './config.js';
import { logger, registerSecrets } from './logger.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig();
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  registerSecrets(collectSecrets(config));

  const { server, context, close } = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('artemis-mcp-server ready on stdio');

  void reportBrokerVersion(context.jolokia, config.brokerName);

  let stopping = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info(`received ${signal}, shutting down`);
    try {
      await server.close();
      await close();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('fatal error during startup', err);
  process.exit(1);
});
