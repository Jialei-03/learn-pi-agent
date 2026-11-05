// 第 12 章实验用的第二个 MCP 服务器：只有一个 result 工具，按 kind 参数返回各种形状的结果，
// 用来看客户端怎样把它们变成模型能读的文字。协议部分和 mcp-server.ts 一样，按行收发 JSON-RPC。
import { createInterface } from 'node:readline';

const send = (message: object) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const results: Record<string, object> = {
  text: { content: [{ type: 'text', text: '#42 [open] 压缩后丢失文件列表' }] },
  error_with_text: { content: [{ type: 'text', text: '权限不足：需要 issues:write' }], isError: true },
  error_empty: { content: [], isError: true },
  structured_only: { content: [], structuredContent: { count: 2, ids: [41, 42] } },
  resource_link: { content: [{ type: 'resource_link', uri: 'issues://42', name: 'issue-42' }] },
  image: { content: [{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }] },
  huge: { content: [{ type: 'text', text: Array.from({ length: 3000 }, (_, i) => `[${String(i).padStart(4, '0')}] compile src/module-${i}.ts ... ok`).join('\n') }] },
};

createInterface({ input: process.stdin }).on('line', line => {
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) return;
  if (method === 'initialize') send({ id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'results', version: '1' } } });
  else if (method === 'tools/list') send({ id, result: { tools: [{ name: 'result', description: '按 kind 返回不同形状的结果。', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: Object.keys(results) } }, required: ['kind'] } }] } });
  else if (method === 'tools/call') send({ id, result: results[params.arguments.kind] });
});
