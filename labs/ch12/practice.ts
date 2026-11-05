// 第 12 章实战检验：mox/src/mcp.ts 的 connectMcp。
//   node labs/ch12/practice.ts                    检验参考实现 mox/
//   MOX_DIR=~/my-mox node labs/ch12/practice.ts   检验你自己写的
// 服务器是 labs/fixtures 里的假 issue 系统（手写协议，不依赖 SDK）和另一个按 kind 返回各种结果的小服务器。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMox, whose } from '../shared/mox-dir.ts';
import { SERVER, serverCommand } from './shared.ts';

const { connectMcp } = await loadMox('mcp.ts');
const rows: [string, string][] = [];
const check = (name: string, observed: string, ok: boolean) => { rows.push([name, `${ok ? '✓' : '✗'} ${observed}`]); assert.ok(ok, `${name}：${observed}`); };
const results = { command: process.execPath, args: [new URL('../fixtures/mcp-results.ts', import.meta.url).pathname] };
const tee = join(import.meta.dirname, '../fixtures/mcp-tee.ts');
const dir = mkdtempSync(join(tmpdir(), 'ch12-practice-'));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const take = async <T>(p: Promise<T>) => { try { return { ok: await p } as { ok: T; error?: undefined }; } catch (e) { return { error: (e as Error).message } as { ok?: undefined; error: string }; } };

console.log(whose() + '\n');
try {
  // 一、连接、命名、调用
  const warnings: string[] = [];
  const log = join(dir, 'wire.log');
  const mcp = await connectMcp({ issues: { command: process.execPath, args: [tee, log, process.execPath, SERVER] } }, (m: string) => warnings.push(m));
  const search = mcp.tools.find((t: any) => t.name === 'mcp__issues__search_issues');
  check('tools/list → Tool', `${mcp.tools.length} 个，其中 ${search?.name}`, mcp.tools.length === 8 && !!search);
  check('描述和参数原样带过来', `${search?.description}；参数 ${Object.keys(search?.parameters?.properties ?? {}).join('、')}`, search?.description.includes('关键词') && !!search?.parameters?.properties?.query);
  const found = await search.run({ query: '压缩' });
  check('tools/call', `返回 ${JSON.stringify(found)}`, typeof found === 'string' && found.includes('#42'));
  const sent = readFileSync(log, 'utf8').split('\n').filter(l => l.startsWith('→')).map(l => JSON.parse(l.slice(2)).method);
  check('线上的顺序', sent.join(' → '), sent.join() === 'initialize,notifications/initialized,tools/list,tools/call');

  // 二、取消：abort 后立刻失败，并通知服务器
  const slow = mcp.tools.find((t: any) => t.name === 'mcp__issues__slow_count');
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 250);
  const started = Date.now();
  const cancelled = await take(slow.run({ to: 10, delayMs: 100 }, controller.signal));
  await sleep(200);
  const cancelNotes = readFileSync(log, 'utf8').split('\n').filter(l => l.includes('notifications/cancelled')).length;
  check('用户取消', `${cancelled.error ?? '没有失败'}（${Date.now() - started}ms）；线上 notifications/cancelled × ${cancelNotes}`, !!cancelled.error && Date.now() - started < 800 && cancelNotes === 1);

  // 三、服务器崩溃：当时的请求失败，之后的调用也立刻失败
  const crash = mcp.tools.find((t: any) => t.name === 'mcp__issues__crash');
  const first = await take(crash.run({}));
  const t0 = Date.now();
  const second = await Promise.race([take(search.run({ query: '' })), sleep(1500).then(() => ({ error: '1.5 秒仍然没有结果（挂住了）' }))]);
  check('服务器崩溃', `当时：${first.error}；之后再调用：${second.error}（${Date.now() - t0}ms）`, !!first.error && !!second.error && !/挂住/.test(second.error ?? ''));
  mcp.close();

  // 四、结果的形状
  const r = await connectMcp({ r: results });
  const call = (kind: string) => take(Promise.resolve(r.tools[0].run({ kind })));
  const text = await call('text'), bad = await call('error_with_text'), image = await call('image');
  check('文本', JSON.stringify(text.ok), text.ok?.includes('#42'));
  check('isError', `抛出：${bad.error}`, bad.error?.includes('权限不足'));
  check('非文本内容块', `变成占位符：${JSON.stringify(image.ok)}`, image.ok === '[image]');
  r.close();

  // 五、起不来只警告，不影响别的服务器
  const w: string[] = [];
  const mixed = await connectMcp({ nonexistent: { command: 'mox-no-such-command' }, quitter: { command: process.execPath, args: ['-e', ''] }, issues: serverCommand }, (m: string) => w.push(m));
  check('起不来的服务器', `${w.length} 条警告；可用的服务器：${[...new Set(mixed.tools.map((t: any) => t.name.split('__')[1]))].join('、')}`, w.length === 2 && mixed.tools.length === 8);
  mixed.close();

  // 六、服务器往 stdout 打了普通日志
  const noisy = await connectMcp({ issues: { ...serverCommand, env: { MCP_FIXTURE_NOISY: '1' } } });
  const ok = await take(Promise.resolve(noisy.tools.find((t: any) => t.name.endsWith('search_issues')).run({ query: 'MCP' })));
  check('stdout 里混进日志', `之后的调用照常：${JSON.stringify(ok.ok)}`, ok.ok?.includes('#43'));
  noisy.close();

  console.log('| 检查 | 观察到 |\n| --- | --- |');
  for (const [name, observed] of rows) console.log(`| ${name} | ${observed} |`);
  console.log('\n（没有检验的一项：握手 10 秒没有回应时的超时，见 labs/ch12/startup.ts。）');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
