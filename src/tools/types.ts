import type { ZodRawShape, z } from 'zod';
import type { Config } from '../config.js';
import type { AmqpClient } from '../artemis/amqpClient.js';
import type { JolokiaClient } from '../artemis/jolokiaClient.js';

export interface ToolContext {
  config: Config;
  jolokia: JolokiaClient;
  amqp: AmqpClient;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: ZodRawShape;
  outputSchema: ZodRawShape;
  /** Tool mutates broker state and is hidden unless ARTEMIS_MODE is "admin". */
  write: boolean;
  /** Tool destroys or relocates data and requires an explicit confirm flag. */
  destructive: boolean;
  handler: (args: unknown, ctx: ToolContext) => Promise<unknown>;
}

interface ToolSpec<S extends ZodRawShape> {
  name: string;
  title: string;
  description: string;
  input: S;
  output: ZodRawShape;
  write?: boolean;
  destructive?: boolean;
  handler: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<unknown>;
}

export function defineTool<S extends ZodRawShape>(spec: ToolSpec<S>): Tool {
  const destructive = spec.destructive ?? false;
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema: spec.input,
    outputSchema: spec.output,
    write: spec.write ?? destructive,
    destructive,
    handler: (args, ctx) => spec.handler(args as z.infer<z.ZodObject<S>>, ctx),
  };
}
