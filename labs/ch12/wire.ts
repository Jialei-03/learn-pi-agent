// 第 12 章实验：MCP 在线路上长什么样？
//   node labs/ch12/wire.ts
// Pi 的 MCP 客户端连接实验用的 issue 服务器，中间插了一个透明的 tee（labs/fixtures/mcp-tee.ts）：
// 它启动真正的服务器，把两个方向的每一行原样转发，同时记进日志。客户端不知道有人在看。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpClient, StdioTransport } from '@earendil-works/pi-mcp';
import { SERVER } from './shared.ts';

const dir = mkdtempSync(join(tmpdir(), 'ch12-wire-'));
const log = join(dir, 'wire.log');
const tee = join(import.meta.dirname, '../fixtures/mcp-tee.ts');
const short = (value: unknown, n = 130) => { const s = JSON.stringify(value); return s.length > n ? s.slice(0, n) + '…' : s; };
let shown = 0;
const dump = (title: string) => {
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  console.log(`━━ ${title} ━━`);
  for (const line of lines.slice(shown)) {
    const m = JSON.parse(line.slice(2));
    const kind = m.method ? (m.id !== undefined ? '请求' : '通知') : '响应';
    console.log(`${line.startsWith('→') ? '客户端 → 服务器' : '服务器 → 客户端'}  ${kind}${m.id !== undefined ? ` #${m.id}` : ''}${m.method ? ` ${m.method}` : ''}`);
    console.log(`    ${short(m.params ?? m.result ?? m.error ?? {})}`);
  }
  const n = lines.length - shown;
  shown = lines.length;
  return n;
};

try {
  const client = new McpClient({ name: 'lab', version: '1.0.0' });
  await client.connect(new StdioTransport({ command: process.execPath, args: [tee, log, process.execPath, SERVER] }));
  // tee 写日志和转发是异步的：最后那条 initialized 通知可能稍晚才落进日志，等它到齐再看
  for (let i = 0; i < 100 && readFileSync(log, 'utf8').trim().split('\n').length < 3; i++) await new Promise(r => setTimeout(r, 20));
  const n1 = dump('1. 握手');
  const tools = await client.listTools();
  dump('2. 列出工具');
  console.log(`  → 共 ${tools.length} 个工具：${tools.map(t => t.name).join('、')}`);
  const result: any = await client.callTool('search_issues', { query: '压缩' });
  dump('3. 调用工具');
  console.log(`  → 模型会看到：${result.content.map((c: any) => c.text).join('')}`);
  await client.callTool('slow_count', { to: 2, delayMs: 50 }, { onProgress: (p: any) => console.log(`  ⋯ 进度回调：${p.message}`) });
  dump('4. 带进度的调用');
  await client.close();
  assert.ok(n1 >= 3);
  assert.equal(tools.length, 8);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
