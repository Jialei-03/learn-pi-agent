// 第 12 章实验：MCP 在线路上长什么样？
//   node labs/ch12/wire.ts
// mox 的客户端连接实验用的 issue 服务器，打印双方收发的每一条 JSON-RPC 消息。
import { McpClient } from '../../mox/src/mcp/client.ts';
import { StdioTransport } from '../../mox/src/mcp/transport.ts';
import { serverCommand } from './shared.ts';

const short = (value: unknown, n = 150) => { const s = JSON.stringify(value); return s.length > n ? s.slice(0, n) + '…' : s; };
const transport = new StdioTransport({
  ...serverCommand,
  onWire: (dir, m) => {
    const kind = m.method ? (m.id !== undefined ? '请求' : '通知') : '响应';
    console.log(`${dir === '→' ? 'mox → 服务器' : '服务器 → mox'}  ${kind}${m.id !== undefined ? ` #${m.id}` : ''}${m.method ? ` ${m.method}` : ''}`);
    console.log(`    ${short(m.params ?? m.result ?? m.error ?? {})}`);
  },
});
const client = new McpClient(transport);

console.log('━━ 1. 握手 ━━');
await client.connect();
console.log('\n━━ 2. 列出工具 ━━');
const tools = await client.listTools();
console.log(`  → 共 ${tools.length} 个工具：${tools.map(t => t.name).join('、')}`);
console.log('\n━━ 3. 调用工具 ━━');
const result = await client.callTool('search_issues', { query: '压缩' });
console.log(`  → 模型会看到：${result.content.map(c => (c.type === 'text' ? c.text : c.type)).join('')}`);
console.log('\n━━ 4. 带进度的调用 ━━');
await client.callTool('slow_count', { to: 2, delayMs: 50 }, { onProgress: p => console.log(`  ⋯ 进度回调：${p.message}`) });
await client.close();
console.log('\n（关闭：先关 stdin，服务器自己退出）');
console.log(`服务器的 stderr：${transport.stderr.trim()}`);
