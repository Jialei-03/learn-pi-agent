// 第 12 章实验：MCP 工具接进 Agent 时的两个细节——起名字、转换结果。mox 与 Pi 对照。
//   node labs/ch12/tools.ts
import { convertMcpResult, createMcpToolName } from '../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/tools.js';
import { convertResult, mcpToolName } from '../../mox/src/mcp/tools.ts';

console.log('━━ 工具名：mcp__服务器__工具 ━━');
const names: [string, string][] = [
  ['issues', 'search_issues'],
  ['issue-tracker', 'create-issue'],                      // 连字符变成下划线
  ['github', 'search.code'],                              // 点号也不行
  ['company-internal-knowledge-base', 'search_confluence_pages_by_label'],  // 超过 64 个字符
];
for (const [server, tool] of names) {
  const mox = mcpToolName(server, tool);
  const pi = createMcpToolName(server, tool);
  console.log(`${server} / ${tool}`);
  console.log(`  mox：${mox}（${mox.length}）${mox === pi ? '' : `  Pi：${pi}`}`);
}
// 同一个服务器上的 a-b 和 a_b 清洗后撞名：两个都加哈希，谁拿到原名不取决于列表顺序
const taken = (n: string) => n === 'mcp__s__a_b';
console.log(`撞名：a-b → ${mcpToolName('s', 'a-b', taken)}，a_b → ${mcpToolName('s', 'a_b', taken)}（Pi：${createMcpToolName('s', 'a-b', taken)}，${createMcpToolName('s', 'a_b', taken)}）`);

console.log('\n━━ 结果转换 ━━');
const save = async () => '/tmp/full-output.txt';
const cases: [string, any][] = [
  ['正常文本', { content: [{ type: 'text', text: '#42 [open] 压缩后丢失文件列表' }] }],
  ['失败但没有任何文字', { content: [], isError: true }],
  ['只有 structuredContent', { content: [], structuredContent: { count: 2 } }],
  ['资源链接', { content: [{ type: 'resource_link', uri: 'issues://42', name: 'issue-42' }] }],
  ['约 110KB 的构建日志', { content: [{ type: 'text', text: Array.from({ length: 3000 }, (_, i) => `[${String(i).padStart(4, '0')}] compile src/module-${i}.ts ... ok`).join('\n') }] }],
];
for (const [label, result] of cases) {
  const mox = convertResult('issues', 'demo', result, () => '/tmp/full-output.txt');
  const pi = await convertMcpResult('issues', 'demo', result, { saveOutput: save });
  const piText = pi.content.map((c: any) => c.text).join('');
  const show = (t: string) => (t.length > 120 ? `${t.slice(0, 50).replace(/\n/g, '⏎')} …… ${t.slice(-70).replace(/\n/g, '⏎')}（共 ${t.length} 字符）` : t.replace(/\n/g, '⏎'));
  console.log(`${label}${result.isError ? '（isError）' : ''}`);
  console.log(`  mox：${show(mox.content)}${mox.isError ? '  [错误]' : ''}`);
  console.log(`  Pi ：${show(piText)}${pi.isError ? '  [错误]' : ''}`);
}
