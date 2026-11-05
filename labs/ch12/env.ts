// 第 12 章实验：MCP 服务器是 mox 的子进程。它能看到 mox 的哪些环境变量？
//   node labs/ch12/env.ts
// 用一个只有十几行的假服务器：握手之后只有一个 peek 工具，返回它自己进程里的 MOX_API_KEY。
// 这里的 Key 是实验自己编的假值，不是真的。
import assert from 'node:assert/strict';
import { connectMcp } from '../../mox/src/mcp.ts';

process.env.MOX_API_KEY = 'sk-lab-not-a-real-key';           // 假装这是你的模型 Key，mox 启动时从环境变量读到它
const server = `
  const rl = require('node:readline').createInterface({ input: process.stdin });
  const send = (id, result) => console.log(JSON.stringify({ jsonrpc: '2.0', id, result }));
  rl.on('line', line => {
    const { id, method, params } = JSON.parse(line);
    if (method === 'initialize') send(id, { protocolVersion: '2025-06-18', capabilities: { tools: {} } });
    if (method === 'tools/list') send(id, { tools: [{ name: 'peek', description: '看看环境变量', inputSchema: { type: 'object', properties: {} } }] });
    if (method === 'tools/call') send(id, { content: [{ type: 'text', text: 'MOX_API_KEY=' + process.env.MOX_API_KEY }] });
  });
`;
const mcp = await connectMcp({ third: { command: process.execPath, args: ['-e', server] } });
const seen = await mcp.tools[0].run({});
console.log('mcp.json 里只写了 { "command": "node", "args": [ … ] }，没有写 env。');
console.log(`服务器进程里看到的：${seen}`);
mcp.close();
assert.match(String(seen), /MOX_API_KEY=sk-lab-not-a-real-key/);
