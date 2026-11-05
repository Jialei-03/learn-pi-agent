// 第 12 章实验：mox 的 MCP 客户端在线路上说了什么？
//   node labs/ch12/wire.ts
// mox 的 connectMcp 连接实验用的 issue 服务器，但中间插了一个 tee（labs/fixtures/mcp-tee.ts）：
// 它把双方的每一行原样转发，同时记进日志。客户端不知道有人在看。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectMcp } from '../../mox/src/mcp.ts';
import { SERVER } from './shared.ts';

const dir = mkdtempSync(join(tmpdir(), 'ch12-wire-'));
const log = join(dir, 'wire.log');
const tee = join(import.meta.dirname, '../fixtures/mcp-tee.ts');
const short = (value: unknown, n = 120) => { const s = JSON.stringify(value); return s.length > n ? s.slice(0, n) + '…' : s; };

try {
  const mcp = await connectMcp({ issues: { command: process.execPath, args: [tee, log, process.execPath, SERVER] } }, m => console.log(`警告：${m}`));
  const dump = (title: string, from: number) => {
    const lines = readFileSync(log, 'utf8').trim().split('\n').slice(from);
    console.log(`━━ ${title} ━━`);
    for (const line of lines) {
      const m = JSON.parse(line.slice(2));
      const kind = m.method ? (m.id !== undefined ? '请求' : '通知') : '响应';
      console.log(`${line.startsWith('→') ? 'mox → 服务器' : '服务器 → mox'}  ${kind}${m.id !== undefined ? ` #${m.id}` : ''}${m.method ? ` ${m.method}` : ''}`);
      console.log(`    ${short(m.params ?? m.result ?? m.error ?? {})}`);
    }
    return lines.length;
  };
  const n1 = dump('连接：握手 + 列出工具（connectMcp 返回时已经全部完成）', 0);
  assert.equal(n1, 5);

  console.log(`\n得到 ${mcp.tools.length} 个 mox 工具：`);
  for (const t of mcp.tools.slice(0, 3)) console.log(`  ${t.name}  参数：${short(t.parameters, 90)}`);
  console.log('  ……');

  const search = mcp.tools.find(t => t.name === 'mcp__issues__search_issues')!;
  const result = await search.run({ query: '压缩' });
  console.log('');
  dump('模型调用 mcp__issues__search_issues', n1);
  console.log(`\n模型看到的结果：${JSON.stringify(result)}`);
  mcp.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
}
