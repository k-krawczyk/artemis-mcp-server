import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { AmqpClient } from './artemis/amqpClient.js';
import { JolokiaClient } from './artemis/jolokiaClient.js';
import type { Config } from './config.js';
import { ToolError } from './errors.js';
import { logger } from './logger.js';
import { adminTools } from './tools/admin.js';
import { managementTools } from './tools/management.js';
import { messagingTools } from './tools/messaging.js';
import { monitoringTools } from './tools/monitoring.js';
import type { Mode } from './config.js';
import type { Tool, ToolContext } from './tools/types.js';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

export const allTools: Tool[] = [
  ...messagingTools,
  ...managementTools,
  ...monitoringTools,
  ...adminTools,
];

export function visibleTools(mode: Mode): Tool[] {
  return allTools.filter((tool) => mode === 'admin' || !tool.write);
}

export async function runTool(
  tool: Tool,
  args: unknown,
  context: ToolContext,
): Promise<CallToolResult> {
  try {
    const parsed = z.object(tool.inputSchema).parse(args ?? {});
    if (tool.destructive && parsed.confirm !== true) {
      throw new ToolError(`${tool.name} is destructive; pass confirm: true to run it`);
    }
    const result = await tool.handler(parsed, context);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      structuredContent: result as Record<string, unknown>,
    };
  } catch (err) {
    if (err instanceof z.ZodError) {
      const detail = err.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      return { content: [{ type: 'text', text: `Invalid arguments: ${detail}` }], isError: true };
    }
    if (!(err instanceof ToolError)) {
      logger.error(`tool ${tool.name} failed`, err);
    }
    const message =
      err instanceof ToolError ? err.message : 'Internal error while executing the tool';
    return { content: [{ type: 'text', text: message }], isError: true };
  }
}

export interface ArtemisServer {
  server: McpServer;
  context: ToolContext;
  close: () => Promise<void>;
}

export function createServer(config: Config): ArtemisServer {
  const amqp = new AmqpClient(config.amqp);
  const jolokia = new JolokiaClient(config.jolokia);
  const context: ToolContext = { config, jolokia, amqp };

  const server = new McpServer({ name: 'artemis-mcp-server', version: pkg.version });

  const exposed = visibleTools(config.mode);
  for (const tool of exposed) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: { readOnlyHint: !tool.write, destructiveHint: tool.destructive },
      },
      (args: unknown) => runTool(tool, args, context),
    );
  }

  logger.info(`registered ${exposed.length} of ${allTools.length} tools in ${config.mode} mode`);

  return {
    server,
    context,
    close: () => amqp.close(),
  };
}
