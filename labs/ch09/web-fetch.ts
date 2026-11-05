// 第 9 章实验：给 Pi 装上 web_fetch 扩展，再用同一份实现给 mox 装上。
//   node labs/ch09/web-fetch.ts
// 本地起一个测试网站。模型依次：抓取文档页；直接访问云平台的元数据地址；访问一个会 302 到元数据地址的链接。
// 后两次都应该被拦下——这是 SSRF（服务端请求伪造）：让 Agent 替攻击者访问它本来能访问、外人访问不到的地址。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/compat';
import { createWebFetchExtension } from '../../extensions/web-fetch/index.ts';
import { createWebFetchMoxExtension } from '../../extensions/web-fetch/mox.ts';
import { loadExtensions } from '../../mox/src/extensions.ts';
import { runLoop, type Tool } from '../../mox/src/loop.ts';
import { createPiSession, textOf } from '../shared/pi-session.ts';
import { scripted } from '../shared/scripted.ts';
import { runMox } from '../shared/mox-cli.ts';

const server = createServer((req, res) => {
  if (req.url === '/redirect') { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/iam/' }); res.end(); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<html><head><title>Mox Notes 文档</title><style>body{color:red}</style><script>track()</script></head><body><h1>安装</h1><p>运行 <code>npm install -g mox-notes</code>。</p><ul><li>mox add</li><li>mox search</li></ul></body></html>');
});
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const options = { trustedHosts: ['127.0.0.1'] };                  // 只信任本地测试服务器
const urls = [`${base}/docs`, 'http://169.254.169.254/latest/meta-data/iam/', `${base}/redirect`];

type Outcome = { text: string; isError: boolean };
const show = (label: string, results: Outcome[]) => {
  console.log(`━━ ${label} ━━`);
  results.forEach((r, i) => console.log(`${i + 1}. ${urls[i].replace(base, '<本地测试站>')}\n   ${r.isError ? '✗' : '✓'} ${r.text.replaceAll(base, '<本地测试站>').split('\n').slice(0, 6).join(' │ ')}`));
  console.log();
};

// ── Pi：真实的 AgentSession + 扩展系统 ─────────────────
const { session } = await createPiSession({
  extensions: [createWebFetchExtension(options)],
  responses: [
    ...urls.map((url, i) => fauxAssistantMessage(fauxToolCall('web_fetch', { url }, { id: `f${i}` }), { stopReason: 'toolUse' })),
    fauxAssistantMessage('读完了。'),
  ],
});
await session.prompt('看看文档');
const piResults = session.messages.filter((m: any) => m.role === 'toolResult').map((m: any) => ({ text: textOf(m), isError: !!m.isError }));
show('Pi', piResults);
session.dispose();

// ── mox：同一份 fetch.ts，换成 mox 的扩展接口（和 `mox -e extensions/web-fetch/mox.ts` 加载的是同一个函数）────
const tools: Tool[] = [];
const extensions = await loadExtensions([createWebFetchMoxExtension(options)], { cwd: '/tmp', tools, ask: async () => undefined });
const messages: Parameters<typeof runLoop>[0] = [{ role: 'user', content: '看看文档' }];
await runLoop(messages, {
  model: scripted((_m, n) => (n <= urls.length ? { toolCalls: [{ name: 'web_fetch', arguments: { url: urls[n - 1] } }] } : { text: '读完了。' })),
  system: '', tools,
  beforeTool: async (name, args) => { const verdict = await extensions.verdict(name, args); return typeof verdict === 'string' ? verdict : undefined; },   // 和 cli.ts 一样：每个扩展都问一遍，字符串才是拒绝
  afterTool: (name, args, result) => extensions.transform(name, args, result),
});
const moxResults = messages.flatMap(m => (m.role === 'tool' ? [{ text: m.content, isError: m.content.startsWith('错误：') }] : []));
show('mox', moxResults);
server.close();

// ── 真正的命令行：mox -e extensions/web-fetch/mox.ts ───────────
// 默认导出的那一份（没有 trustedHosts），模型是本地假服务。工具清单里应该多出 web_fetch，访问元数据地址应该被拦下。
const root = mkdtempSync(join(tmpdir(), 'ch09-wf-'));
mkdirSync(join(root, 'home'));
const cli = await runMox(['-p', '看看元数据', '--yolo', '-e', join(import.meta.dirname, '../../extensions/web-fetch/mox.ts')], {
  cwd: root, home: join(root, 'home'),
  script: (_request, n) => (n === 1 ? { toolCalls: [{ name: 'web_fetch', arguments: { url: urls[1] } }] } : { text: '抓不到。' }),
});
const toolNames = cli.requests[0].tools!.map(t => t.function.name);
console.log('━━ mox -e extensions/web-fetch/mox.ts ━━');
console.log(`发给模型的工具：${toolNames.join('、')}`);
console.log(cli.output.trim().split('\n').slice(0, 3).join('\n'));
assert.equal(cli.code, 0);
assert.ok(toolNames.includes('web_fetch'));
assert.match(cli.output, /拒绝访问内网地址/);

// 两个宿主：文档页抓到了，后两次（直接访问、302 跳转）都被拦下
for (const results of [piResults, moxResults]) {
  assert.deepEqual(results.map(r => r.isError), [false, true, true]);
  assert.match(results[0].text, /安装/);
  assert.doesNotMatch(results[0].text, /track\(\)|color:red/);
}
