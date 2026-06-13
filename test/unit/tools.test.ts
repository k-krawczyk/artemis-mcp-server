import { describe, expect, it, vi } from 'vitest';
import { allTools, runTool, visibleTools } from '../../src/server.js';
import type { Tool, ToolContext } from '../../src/tools/types.js';

function toolByName(name: string): Tool {
  const tool = allTools.find((t) => t.name === name);
  if (!tool) throw new Error(`unknown tool ${name}`);
  return tool;
}

function makeContext(over: {
  exec?: ReturnType<typeof vi.fn>;
  search?: ReturnType<typeof vi.fn>;
  read?: ReturnType<typeof vi.fn>;
}): ToolContext {
  return {
    config: { brokerName: '0.0.0.0', maxBrowse: 200 },
    jolokia: {
      exec: over.exec ?? vi.fn(),
      search: over.search ?? vi.fn().mockResolvedValue(['mbean:orders']),
      read: over.read ?? vi.fn(),
    },
    amqp: {},
  } as unknown as ToolContext;
}

function textOf(result: { content: Array<{ type: string }> }): string {
  const part = result.content[0] as { text: string };
  return part.text;
}

describe('tool visibility by mode', () => {
  it('hides every write tool in read-only mode', () => {
    const names = visibleTools('read-only').map((t) => t.name);
    expect(names).toContain('list_queues');
    expect(names).toContain('browse_messages');
    expect(names).not.toContain('send_message');
    expect(names).not.toContain('purge_queue');
  });

  it('exposes all tools in admin mode', () => {
    expect(visibleTools('admin')).toHaveLength(allTools.length);
  });

  it('marks every destructive tool as a write tool', () => {
    for (const tool of allTools) {
      if (tool.destructive) expect(tool.write).toBe(true);
    }
  });
});

describe('confirm gating', () => {
  it('refuses a destructive tool without confirm and never touches the broker', async () => {
    const exec = vi.fn();
    const search = vi.fn();
    const result = await runTool(
      toolByName('purge_queue'),
      { queue: 'orders', confirm: false },
      makeContext({ exec, search }),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/confirm/);
    expect(exec).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });

  it('runs a destructive tool once confirm is true', async () => {
    const exec = vi.fn().mockResolvedValue(5);
    const result = await runTool(
      toolByName('purge_queue'),
      { queue: 'orders', confirm: true },
      makeContext({ exec }),
    );
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ queue: 'orders', removed: 5 });
    expect(exec).toHaveBeenCalledWith('mbean:orders', 'removeMessages(java.lang.String)', ['']);
  });
});

describe('error handling', () => {
  it('passes through tool errors as readable messages', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const result = await runTool(
      toolByName('get_queue_info'),
      { queue: 'ghost' },
      makeContext({ search }),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Queue not found/);
  });

  it('masks unexpected errors behind a generic message', async () => {
    const exec = vi.fn().mockRejectedValue(new Error('socket exploded'));
    const result = await runTool(toolByName('list_queues'), {}, makeContext({ exec }));
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Internal error while executing the tool');
    expect(textOf(result)).not.toContain('socket exploded');
  });
});

describe('read tool output', () => {
  it('returns structured content for list_queues', async () => {
    const exec = vi.fn().mockResolvedValue(['a', 'b']);
    const result = await runTool(toolByName('list_queues'), {}, makeContext({ exec }));
    expect(result.structuredContent).toEqual({ count: 2, queues: ['a', 'b'] });
  });
});
