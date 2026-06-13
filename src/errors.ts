/**
 * Carries a message that is safe to return to the MCP client. Anything thrown
 * that is not a ToolError is treated as unexpected and replaced with a generic
 * message so internal details and stack traces never reach the model.
 */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export class JolokiaError extends ToolError {
  constructor(
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'JolokiaError';
  }
}

export class AmqpOperationError extends ToolError {
  constructor(message: string) {
    super(message);
    this.name = 'AmqpOperationError';
  }
}
