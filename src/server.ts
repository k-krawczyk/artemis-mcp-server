import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AmqpClient } from './artemis/amqpClient.js';
import { JolokiaClient } from './artemis/jolokiaClient.js';
import type { Config } from './config.js';
import { ToolError } from './errors.js';
import { logger } from './logger.js';
import { adminTools } from './tools/admin.js';
import { managementTools } from './tools/management.js';
import { messagingTools } from './tools/messaging.js';
import { monitoringTools } from './tools/monitoring.js';
import type { Tool, ToolContext } from './tools/types.js';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

export interface ArtemisServer {
  server: McpServer;
  close: () => Promise<void>;
}

export function createServer(config: Config): ArtemisServer {
  const amqp = new AmqpClient(config.amqp);
  const jolokia = new JolokiaClient(config.jolokia);
  const context: ToolContext = { config, jolokia, amqp };

  const server = new McpServer({ name: 'artemis-mcp-server', version: pkg.version });

  const all: Tool[] = [...messagingTools, ...managementTools, ...monitoringTools, ...adminTools];
  const exposed = all.filter((tool) => config.mode === 'admin' || !tool.write);
  for (const tool of exposed) {
    register(server, tool, context);
  }

  logger.info(`registered ${exposed.length} of ${all.length} tools in ${config.mode} mode`);

  return {
    server,
    close: () => amqp.close(),
  };
}

function register(server: McpServer, tool: Tool, context: ToolContext): void {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: { readOnlyHint: !tool.write, destructiveHint: tool.destructive },
    },
    async (args: unknown): Promise<CallToolResult> => {
      try {
        if (tool.destructive && (args as { confirm?: boolean }).confirm !== true) {
          throw new ToolError(`${tool.name} is destructive; pass confirm: true to run it`);
        }
        const result = await tool.handler(args, context);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (err) {
        if (!(err instanceof ToolError)) {
          logger.error(`tool ${tool.name} failed`, err);
        }
        const message =
          err instanceof ToolError ? err.message : 'Internal error while executing the tool';
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );
}
