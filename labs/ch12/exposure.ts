// 第 12 章实验：工具太多怎么办？mox 的做法是全部注册、每次请求全部发送——这样的代价有多大？
//   node labs/ch12/exposure.ts
// 真正的 mox 命令行，.mox/mcp.json 里配 1、3、6 个（都是实验用的 issue 服务器，每个 8 个工具），用 --trust 加载。
// 假模型服务器记下每次请求里的 tools 字段。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { estimateTokens } from '../../mox/src/compact.ts';
import { runMox } from '../shared/mox-cli.ts';
import { serverCommand } from './shared.ts';

const tmp = (name: string) => realpathSync(mkdtempSync(join(tmpdir(), name)));
const home = tmp('ch12-home-');
const rows = ['| mcp.json 里的服务器 | 第 1 次请求的工具数 | 第 2 次请求的工具数 | 工具定义的估算 tokens | 占 128K 窗口 |', '| --- | --- | --- | --- | --- |'];
const counts: number[] = [];
let builtin: string[] = [];
try {
  for (const n of [0, 1, 3, 6]) {
    const project = tmp('ch12-proj-');
    mkdirSync(join(project, '.mox'));
    writeFileSync(join(project, '.mox', 'mcp.json'), JSON.stringify({ mcpServers: Object.fromEntries(Array.from({ length: n }, (_, i) => [`issues${i + 1}`, serverCommand])) }));
    const run = await runMox(['--trust', '-p', '你好'], {
      cwd: project, home,
      script: (_request, k) => (k === 1 ? { toolCalls: [{ name: 'read', arguments: { path: 'nothing.txt' } }] } : { text: '好的。' }),
    });
    assert.equal(run.requests.length, 2);
    const [first, second] = run.requests.map(r => r.tools!.length);
    const tokens = estimateTokens(run.requests[0].tools);
    counts.push(first);
    if (n === 0) builtin = run.requests[0].tools!.map(t => t.function.name);
    rows.push(`| ${n} 个 | ${first} | ${second} | ${tokens} | ${(tokens / 1280).toFixed(1)}% |`);
    rmSync(project, { recursive: true, force: true });
    assert.equal(first, second, '每次请求带的工具一样多');
  }
  console.log(rows.join('\n'));
  console.log(`\n没有 MCP 时是 ${counts[0]} 个工具（${builtin.join('、')}）；每多一个服务器多 8 个，而且是每一次请求都带着，不管这次用不用。`);
  assert.deepEqual(counts, [0, 1, 3, 6].map(n => counts[0] + 8 * n));
} finally {
  rmSync(home, { recursive: true, force: true });
}
