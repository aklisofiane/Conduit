#!/usr/bin/env node
// @ts-check
/**
 * Tiny stdio MCP server for tests. Transport is newline-delimited JSON over
 * stdio per MCP spec; surface is `initialize`, `tools/list`, `tools/call`.
 *
 * Tools:
 *   echo({ text })        → { text }
 *   add({ a, b })         → { sum: a+b }
 *   fail({ message })     → throws, for error-path tests
 */
import { createInterface } from 'node:readline';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'conduit-stub-mcp', version: '0.0.0' };

const TOOLS = [
  {
    name: 'echo',
    description: 'Returns its input text verbatim.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
  {
    name: 'add',
    description: 'Returns the sum of two numbers.',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
  },
  {
    name: 'fail',
    description: 'Throws the supplied message — used to exercise error paths.',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
  },
];

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function ok(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function err(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function callTool(name, args) {
  switch (name) {
    case 'echo':
      return { content: [{ type: 'text', text: String(args?.text ?? '') }] };
    case 'add':
      return {
        content: [{ type: 'text', text: String(Number(args?.a ?? 0) + Number(args?.b ?? 0)) }],
      };
    case 'fail':
      throw new Error(String(args?.message ?? 'stub-fail'));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const rl = createInterface({ input: process.stdin });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  const { id, method, params } = msg;

  try {
    switch (method) {
      case 'initialize':
        ok(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
        return;
      case 'notifications/initialized':
        return; // notification, no response
      case 'tools/list':
        ok(id, { tools: TOOLS });
        return;
      case 'tools/call': {
        const result = callTool(params?.name, params?.arguments);
        ok(id, result);
        return;
      }
      case 'shutdown':
        ok(id, null);
        return;
      default:
        if (id !== undefined) err(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    if (id !== undefined) {
      err(id, -32000, e instanceof Error ? e.message : String(e));
    }
  }
});

rl.on('close', () => process.exit(0));
