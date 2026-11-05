// 第 12 章实验：MCP 工具接进 Agent 时的两个细节——起名字、转换结果。mox 与 Pi 对照。
//   node labs/ch12/tools.ts
// mox 这一侧是真正的 connectMcp 产生的工具；Pi 这一侧是它的 createMcpToolName 和 convertMcpResult。
import assert from 'node:assert/strict';
import { McpClient as PiClient, StdioTransport as PiStdio } from '@earendil-works/pi-mcp';
import { convertMcpResult, createMcpToolName } from '../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/tools.js';
import { connectMcp } from '../../mox/src/mcp.ts';
import { serverCommand } from './shared.ts';

// ── 一、工具名：mcp__服务器__工具 ──
const odd = ['search.code', 'a.b', 'a_b', 'search_confluence_pages_by_label_and_space_with_pagination_support', 'search_confluence_pages_by_label_and_space_with_pagination_options'];
const mcp = await connectMcp({ s: { ...serverCommand, env: { MCP_FIXTURE_TOOLS: 'odd' } } });
const moxNames = mcp.tools.map(t => t.name);
const taken = new Set<string>();
const piNames = odd.map(tool => { const name = createMcpToolName('s', tool, name => taken.has(name)); taken.add(name); return name; });

console.log('| 服务器里的工具名 | mox 注册的名字 | Pi 注册的名字 |');
console.log('| --- | --- | --- |');
odd.forEach((tool, i) => console.log(`| \`${tool.length > 30 ? tool.slice(0, 27) + '…' : tool}\`（${tool.length}） | \`${moxNames[i].length > 40 ? moxNames[i].slice(0, 37) + '…' : moxNames[i]}\`（${moxNames[i].length}） | \`${piNames[i].length > 40 ? piNames[i].slice(0, 37) + '…' : piNames[i]}\`（${piNames[i].length}） |`));
console.log(`\nmox 注册的 ${odd.length} 个名字里，有 ${moxNames.length - new Set(moxNames).size} 个是重复的；Pi 给撞名的加了哈希，重复的有 ${piNames.length - new Set(piNames).size} 个。`);
console.log('重名意味着什么：循环按名字用 find 找工具，只会找到第一个，后一个永远调用不到。');
assert.equal(moxNames[0], 'mcp__s__search_code');
assert.equal(moxNames[1], moxNames[2]);
assert.ok(moxNames.every(n => n.length <= 64));
assert.equal(moxNames[3], moxNames[4]);
assert.equal(new Set(piNames).size, piNames.length);
mcp.close();

// ── 二、结果：模型最后看到什么 ──
const results = await connectMcp({ r: { command: process.execPath, args: [new URL('../fixtures/mcp-results.ts', import.meta.url).pathname] } });
const resultTool = results.tools[0];
const pi = new PiClient({ name: 'lab', version: '1.0.0' });
await pi.connect(new PiStdio({ command: process.execPath, args: [new URL('../fixtures/mcp-results.ts', import.meta.url).pathname] }));

const show = (t: string) => (t.length > 130 ? `${t.slice(0, 40).replace(/\n/g, '⏎')} …… ${t.slice(-50).replace(/\n/g, '⏎')}（共 ${t.length} 字符）` : t.replace(/\n/g, '⏎'));
const cases: [string, string][] = [
  ['text', '正常文本'], ['error_with_text', '失败，带说明'], ['error_empty', '失败，没有任何文字'],
  ['structured_only', '只有 structuredContent'], ['resource_link', '资源链接'], ['image', '图片'], ['huge', '约 110KB 的构建日志'],
];
const seen: Record<string, string> = {};
console.log('\n| 服务器返回的 | mox：模型看到的 | Pi：模型看到的 |');
console.log('| --- | --- | --- |');
for (const [kind, label] of cases) {
  let moxText: string;
  try { moxText = String(await resultTool.run({ kind })); } catch (e) { moxText = `错误：${(e as Error).message}`; }   // 抛出的错误，循环会加上“错误：”交给模型
  const raw = await pi.callTool('result', { kind });
  const converted = await convertMcpResult('r', 'result', raw as any, { saveOutput: async () => '/tmp/full-output.txt' });
  const piText = converted.content.map((c: any) => c.text).join('');
  seen[kind] = moxText;
  console.log(`| ${label} | ${show(moxText)} | ${show(piText)}${converted.isError ? ' [错误]' : ''} |`);
}
results.close();
await pi.close();
assert.equal(seen.error_empty, '错误：');
assert.equal(seen.structured_only, '');
assert.ok(seen.huge.length > 100_000);
process.exit(0);
