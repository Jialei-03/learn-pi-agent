// 第 9 章实验：给 Pi 装上 web_fetch 扩展。
//   node labs/ch09/web-fetch.ts
// 本地起一个测试网站。模型依次：抓取文档页；直接访问云平台的元数据地址；访问一个会 302 到元数据地址的链接。
// 后两次都应该被拦下——这是 SSRF（服务端请求伪造）：让 Agent 替攻击者访问它本来能访问、外人访问不到的地址。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/compat';
import { createWebFetchExtension } from '../../extensions/web-fetch/index.ts';
import { createPiSession, textOf } from '../shared/pi-session.ts';

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

server.close();

assert.deepEqual(piResults.map(r => r.isError), [false, true, true]);   // 文档页抓到了，直接访问和 302 跳转都被拦下
assert.match(piResults[0].text, /安装/);
assert.doesNotMatch(piResults[0].text, /track\(\)|color:red/);       // 脚本和样式被去掉了
