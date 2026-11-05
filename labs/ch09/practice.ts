// 第 9 章实战检验：你给 mox 写的扩展系统（src/extensions.ts）和 web_fetch 扩展。
//   node labs/ch09/practice.ts                          检验参考实现 mox/
//   MOX_DIR=~/my-mox node labs/ch09/practice.ts         检验你自己的 mox
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWebFetchMoxExtension } from '../../extensions/web-fetch/mox.ts';
import { loadMox, whose } from '../shared/mox-dir.ts';
import { scripted } from '../shared/scripted.ts';

const { loadExtensions, extensionFiles } = await loadMox('extensions.ts');
const { runLoop } = await loadMox('loop.ts');
const { codingTools } = await loadMox('tools.ts');

console.log(whose());
console.log();
const rows: [string, string][] = [];
async function check(name: string, run: () => Promise<string> | string) {
  try { rows.push([name, `通过：${await run()}`]); } catch (e) { rows.push([name, `**失败**：${(e as Error).message.split('\n')[0]}`]); process.exitCode = 1; }
}
const host = (tools: any[] = []) => ({ cwd: '/tmp', tools, ask: async (_q: string, choices: string[]) => choices[1] });

// ── 第 1 步：注册 ──
await check('registerTool：新名字追加，同名替换', async () => {
  const tools: any[] = [{ name: 'bash', run: () => 'old' }, { name: 'read', run: () => 'r' }];
  await loadExtensions([(mox: any) => { mox.registerTool({ name: 'now', run: () => 't' }); mox.registerTool({ name: 'bash', run: () => 'new' }); }], host(tools));
  assert.deepEqual(tools.map(t => t.name), ['bash', 'read', 'now']);
  assert.equal(tools[0].run(), 'new');
  return `${tools.map(t => t.name).join('、')}，bash 被替换且位置不变`;
});
await check('registerCommand、addSystemPrompt、ask', async () => {
  let n = 0;
  const ext = await loadExtensions([(mox: any) => {
    mox.registerCommand('hello', (a: string) => `你好 ${a}`);
    mox.addSystemPrompt(() => `第 ${++n} 次取值`);
    mox.registerCommand('q', () => mox.ask('确定？', ['是', '否']));
  }], host());
  assert.equal(await ext.commands.get('hello')('小明'), '你好 小明');
  assert.deepEqual([ext.prompts[0](), ext.prompts[0]()], ['第 1 次取值', '第 2 次取值']);
  assert.equal(await ext.commands.get('q')(''), '否');
  return '命令能调用，系统提示片段每次重新取值，ask 转给宿主';
});
await check('加载顺序：用户目录、项目目录各自按文件名排序', () => {
  const root = mkdtempSync(join(tmpdir(), 'ch09-p-'));
  mkdirSync(join(root, 'a')); writeFileSync(join(root, 'a/b.ts'), ''); writeFileSync(join(root, 'a/a.ts'), ''); writeFileSync(join(root, 'a/x.txt'), '');
  const files = extensionFiles([join(root, 'a'), join(root, 'missing')]).map((f: string) => f.split('/').at(-1));
  assert.deepEqual(files, ['a.ts', 'b.ts']);
  return `${files.join('、')}（.txt 和不存在的目录被忽略）`;
});

// ── 第 2 步：三个分发函数 ──
await check('verdict：每个扩展都被问到，拒绝优先，true 放行', async () => {
  const asked: string[] = [];
  const mk = (label: string, answer: unknown) => (mox: any) => mox.on('tool_call', () => { asked.push(label); return answer; });
  assert.equal(await (await loadExtensions([mk('allow', true), mk('deny', '不行')], host())).verdict('bash', {}), '不行');   // 放行在前、拒绝在后：照样拒绝
  assert.equal(await (await loadExtensions([mk('deny', '不行'), mk('allow', true)], host())).verdict('bash', {}), '不行');
  assert.equal(await (await loadExtensions([mk('none', undefined), mk('allow', true)], host())).verdict('bash', {}), true);
  assert.equal(await (await loadExtensions([mk('none', undefined)], host())).verdict('bash', {}), undefined);
  assert.equal(await (await loadExtensions([mk('empty', '')], host())).verdict('bash', {}), undefined);                    // 空字符串是“没意见”
  return '放行在前拒绝在后、顺序反过来，结果都是拒绝；空字符串不算拒绝';
});
await check('transform：tool_result 接力，后一个看到前一个的结果', async () => {
  const ext = await loadExtensions([
    (mox: any) => mox.on('tool_result', (_n: string, _a: unknown, r: string) => `${r}\n（C 看过了）`),
    (mox: any) => mox.on('tool_result', (_n: string, _a: unknown, r: string) => r.replace(/ghp_\w+/, 'ghp_***')),
  ], host());
  const out = await ext.transform('bash', {}, 'token=ghp_abc123');
  assert.equal(out, 'token=ghp_***\n（C 看过了）');
  return JSON.stringify(out);
});
await check('emit：agent_end 第一个返回字符串的说了算', async () => {
  const ext = await loadExtensions([(mox: any) => mox.on('agent_end', () => undefined), (mox: any) => mox.on('agent_end', () => '再检查一遍'), (mox: any) => mox.on('agent_end', () => '不会被用到')], host());
  assert.equal(ext.text(await ext.emit('agent_end', '完成')), '再检查一遍');
  assert.equal(ext.text(await ext.emit('shutdown')), undefined);
  return '「再检查一遍」';
});

// ── 第 3 步：接进循环（和 cli.ts 里的 beforeTool / afterTool 一样）──
await check('接进 runLoop：就地改参数、拒绝、接力改结果', async () => {
  const executed: string[] = [];
  const tools = [{ name: 'shell', description: '', parameters: { type: 'object', properties: {} }, run: ({ command }: any) => { executed.push(command); return `执行了：${command}\ntoken=ghp_abc123`; } }];
  const ext = await loadExtensions([
    (mox: any) => mox.on('tool_call', (_n: string, a: any) => { a.command = a.command.replace(/\bnpm\b/, 'pnpm'); }),
    (mox: any) => mox.on('tool_call', (_n: string, a: any) => (a.command.includes('publish') ? '不允许发布' : undefined)),
    (mox: any) => mox.on('tool_result', (_n: string, _a: unknown, r: string) => `${r}\n（C 看过了）`),
    (mox: any) => mox.on('tool_result', (_n: string, _a: unknown, r: string) => r.replace(/ghp_\w+/, 'ghp_***')),
  ], host(tools));
  const messages: any[] = [{ role: 'user', content: 'go' }];
  await runLoop(messages, {
    model: scripted([{ toolCalls: [{ name: 'shell', arguments: { command: 'npm test' } }, { name: 'shell', arguments: { command: 'npm publish' } }] }, { text: '好。' }]), system: '', tools,
    beforeTool: async (name: string, args: unknown) => { const v = await ext.verdict(name, args); return typeof v === 'string' ? v : undefined; },
    afterTool: (name: string, args: unknown, result: string) => ext.transform(name, args, result),
  });
  const results = messages.filter(m => m.role === 'tool').map(m => m.content);
  assert.deepEqual(executed, ['pnpm test']);
  assert.equal(results[0], '执行了：pnpm test\ntoken=ghp_***\n（C 看过了）');
  assert.match(results[1], /不允许发布/);
  return `实际执行 ${executed.join('、')}；publish 被拒绝；令牌已遮盖`;
});

// ── 第 4 步：web_fetch 扩展 ──
await check('web_fetch 扩展：抓到文档页，拦下元数据地址和 302', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><head><title>文档</title><script>track()</script></head><body><h1>安装</h1><p>运行 npm install。</p></body></html>');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const tools = codingTools('/tmp');
    const ext = await loadExtensions([createWebFetchMoxExtension({ trustedHosts: ['127.0.0.1'] })], host(tools));
    assert.ok(tools.some((t: any) => t.name === 'web_fetch'));
    const urls = [`${base}/docs`, 'http://169.254.169.254/latest/meta-data/', `${base}/redirect`];
    const messages: any[] = [{ role: 'user', content: 'go' }];
    await runLoop(messages, {
      model: scripted((_m, n) => (n <= 3 ? { toolCalls: [{ name: 'web_fetch', arguments: { url: urls[n - 1] } }] } : { text: '好。' })), system: '', tools,
      beforeTool: async (name: string, args: unknown) => { const v = await ext.verdict(name, args); return typeof v === 'string' ? v : undefined; },
      afterTool: (name: string, args: unknown, result: string) => ext.transform(name, args, result),
    });
    const results = messages.filter(m => m.role === 'tool').map(m => m.content as string);
    assert.match(results[0], /安装/); assert.doesNotMatch(results[0], /track\(\)/);
    assert.match(results[1], /拒绝访问内网地址/);
    assert.match(results[2], /重定向被拒绝/);
    return '文档页正文干净；元数据地址和 302 都被拒绝';
  } finally { server.close(); }
});

console.log('| 检查 | 结果 |');
console.log('| --- | --- |');
for (const [name, result] of rows) console.log(`| ${name} | ${result.replace(/\|/g, '\\|')} |`);
