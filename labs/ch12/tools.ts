// 第 12 章实验：MCP 工具接进 Pi 时的两个细节——起名字、转换结果。
//   node labs/ch12/tools.ts
// 用 Pi 真实的 createMcpToolName 和 convertMcpResult。结果的“原料”来自实验里的第二个服务器
// （labs/fixtures/mcp-results.ts，按 kind 参数返回各种形状的结果），经 Pi 的 MCP 客户端取回。
import assert from 'node:assert/strict';
import { McpClient, StdioTransport } from '@earendil-works/pi-mcp';
import { convertMcpResult, createMcpToolName } from '../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/tools.js';

// ── 一、工具名：mcp__服务器__工具 ──
const names: [string, string][] = [
  ['issues', 'search_issues'],
  ['issue-tracker', 'create-issue'],                      // 连字符变成下划线
  ['github', 'search.code'],                              // 点号也不行
  ['company-internal-knowledge-base', 'search_confluence_pages_by_label'],  // 超过 64 个字符
];
console.log('| 服务器 / 工具 | Pi 注册的名字 | 长度 |\n| --- | --- | --- |');
for (const [server, tool] of names) {
  const name = createMcpToolName(server, tool);
  console.log(`| ${server} / ${tool} | \`${name}\` | ${name.length} |`);
  assert.ok(name.length <= 64 && /^[\w-]+$/.test(name));
}
// 同一个服务器上的 a-b 和 a_b 清洗后撞名：两个都加哈希，谁拿到原名不取决于列表顺序
const taken = (n: string) => n === 'mcp__s__a_b';
const [x, y] = [createMcpToolName('s', 'a-b', taken), createMcpToolName('s', 'a_b', taken)];
console.log(`\n撞名：a-b → \`${x}\`，a_b → \`${y}\`（已经有一个叫 mcp__s__a_b 的工具了）`);
assert.notEqual(x, y);

// ── 二、结果：模型最后看到什么 ──
const results = new URL('../fixtures/mcp-results.ts', import.meta.url).pathname;
const client = new McpClient({ name: 'lab', version: '1.0.0' });
await client.connect(new StdioTransport({ command: process.execPath, args: [results] }));
const show = (t: string) => (t.length > 130 ? `${t.slice(0, 40).replace(/\n/g, '⏎')} …… ${t.slice(-50).replace(/\n/g, '⏎')}（共 ${t.length} 字符）` : t.replace(/\n/g, '⏎'));
const cases: [string, string][] = [
  ['text', '正常文本'], ['error_with_text', '失败，带说明'], ['error_empty', '失败，没有任何文字'],
  ['structured_only', '只有 structuredContent'], ['resource_link', '资源链接'], ['image', '图片'], ['huge', '约 110KB 的构建日志'],
];
console.log('\n| 服务器返回的 | Pi：模型看到的 |\n| --- | --- |');
const seen: Record<string, { text: string; isError: boolean }> = {};
for (const [kind, label] of cases) {
  const raw = await client.callTool('result', { kind });
  const converted = await convertMcpResult('r', 'result', raw as any, { saveOutput: async () => '/tmp/full-output.txt' });
  const text = converted.content.map((c: any) => c.text).join('');
  seen[kind] = { text, isError: !!converted.isError };
  console.log(`| ${label} | ${show(text)}${converted.isError ? ' [错误]' : ''} |`);
}
await client.close();
assert.ok(seen.error_empty.isError && seen.error_empty.text.length > 0, '失败却没有文字时补一句说明');
assert.ok(seen.structured_only.text.includes('"count"'), '只有 structuredContent 时序列化成 JSON');
assert.ok(seen.huge.text.length < 30_000 && seen.huge.text.includes('full-output.txt'), '过长的结果保留首尾，完整内容存文件');
process.exit(0);
