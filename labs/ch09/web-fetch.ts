// 第 9 章实验：给 Pi 装上 web_fetch 扩展，再用同一份实现给 mox 装上。
//   node labs/ch09/web-fetch.ts
// 本地起一个测试网站。模型依次：抓取文档页；直接访问云平台的元数据地址；访问一个会 302 到元数据地址的链接。
// 后两次都应该被拦下——这是 SSRF（服务端请求伪造）：让 Agent 替攻击者访问它本来能访问、外人访问不到的地址。
import { createServer } from 'node:http';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/compat';
import { ExtensionHost } from '../../mox/src/extensions.ts';
import { runLoop } from '../../mox/src/loop.ts';
import { scripted } from '../../mox/src/providers/scripted.ts';
import { createWebFetchExtension } from '../../extensions/web-fetch/index.ts';
import { createWebFetchMoxExtension } from '../../extensions/web-fetch/mox.ts';
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

const show = (label: string, results: { text: string; isError: boolean }[]) => {
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
show('Pi', session.messages.filter((m: any) => m.role === 'toolResult').map((m: any) => ({ text: textOf(m), isError: m.isError })));
session.dispose();

// ── mox：同一份 fetch.ts，换成 mox 的扩展接口 ─────────
const host = new ExtensionHost('/tmp');
await host.load('web-fetch', createWebFetchMoxExtension(options));
const { messages } = await runLoop([], [{ role: 'user', content: '看看文档' }], {
  model: scripted((_c, n) => (n <= urls.length ? { toolCalls: [{ name: 'web_fetch', arguments: { url: urls[n - 1] } }] } : { text: '读完了。' })),
  systemPrompt: '', tools: host.tools, hooks: host.toolHooks(),
});
show('mox', messages.filter(m => m.role === 'toolResult').map(m => ({ text: (m as any).content, isError: (m as any).isError })));
server.close();
