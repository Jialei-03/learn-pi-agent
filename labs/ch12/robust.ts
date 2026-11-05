// 第 12 章实验：一个能用的 MCP 客户端，要扛住哪些情况？Pi 的客户端跑六个场景。
//   node labs/ch12/robust.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { McpClient as PiClient, StdioTransport as PiStdio } from '@earendil-works/pi-mcp';
import { serverCommand } from './shared.ts';

interface Harness {
  call(name: string, args: Record<string, unknown>, options?: { signal?: AbortSignal; timeoutMs?: number; onProgress?: (p: any) => void }): Promise<any>;
  stderr(): string;
  errors: string[];
  close(): Promise<void>;
}

async function pi(env: Record<string, string> = {}): Promise<Harness> {
  const transport = new PiStdio({ ...serverCommand, env });
  const client = new PiClient({ name: 'lab', version: '1.0.0' });
  const errors: string[] = [];
  client.onError(e => errors.push(e.message));
  await client.connect(transport);
  return { call: (n, a, o) => client.callTool(n, a, o), stderr: () => transport.stderr, errors, close: () => client.close() };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const text = (r: any) => r.content.map((c: any) => c.text).join('');
async function outcome(p: Promise<any>) {
  const start = Date.now();
  try { return `成功 —— ${text(await p)}`; } catch (e) { const ms = Date.now() - start;
    return `失败 —— ${(e as Error).message}（${ms < 50 ? '立刻' : `约 ${Math.round(ms / 100) * 100}ms`}）`; }
}
const serverSaw = (h: Harness) => h.stderr().split('\n').filter(l => l.includes('取消') || l.includes('crash')).map(l => l.replace('[issues] ', '')).join('；') || '（没有记录）';

const scenarios: [string, (connect: typeof pi) => Promise<string[]>][] = [
  ['① 有进度：超时 400ms，任务约 750ms，但每 150ms 报告一次进度', async connect => {
    const h = await connect();
    const r = await outcome(h.call('slow_count', { to: 5, delayMs: 150 }, { timeoutMs: 400, onProgress: () => {} }));
    await h.close();
    return [r];
  }],
  ['② 没有进度：同样的任务，不要求进度', async connect => {
    const h = await connect();
    const r = await outcome(h.call('slow_count', { to: 5, delayMs: 150 }, { timeoutMs: 400 }));
    await sleep(300);
    await h.close();
    return [r, `服务器：${serverSaw(h)}`];
  }],
  ['③ 用户中途取消（250ms 后 abort）', async connect => {
    const h = await connect();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 250);            // 两次计数（每 100ms 一次）之间，结果才稳定
    const r = await outcome(h.call('slow_count', { to: 10, delayMs: 100 }, { signal: controller.signal }));
    await sleep(200);
    await h.close();
    return [r, `服务器：${serverSaw(h)}`];
  }],
  ['④ 服务器把日志打到了 stdout', async connect => {
    const h = await connect({ MCP_FIXTURE_NOISY: '1' });
    const r = await outcome(h.call('search_issues', { query: 'MCP' }));
    await h.close();
    return [`报告的错误：${h.errors.join('；') || '无'}`, `之后的调用：${r}`];
  }],
  ['⑤ 服务器在处理请求时崩溃（超时设为 30 秒）', async connect => {
    const h = await connect();
    const r = await outcome(h.call('crash', {}, { timeoutMs: 30_000 }));
    await h.close();
    return [r];
  }],
  ['⑥ 服务器启动了子进程，客户端关闭连接', async connect => {
    const h = await connect();
    const pid = Number(text(await h.call('spawn_worker', {})).match(/\d+/)![0]);
    await h.close();
    await sleep(100);
    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    if (alive) process.kill(pid, 'SIGKILL');
    return [`子进程${alive ? '还活着（泄漏了）' : '已被清理'}`];
  }],
];

/** 朴素的做法：普通 spawn，关闭时只关 stdin，等服务器退出。服务器退出了，它启动的子进程呢？ */
async function naiveLeak(): Promise<string> {
  const child = spawn(serverCommand.command, serverCommand.args, { stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = createInterface({ input: child.stdout! });
  const reply = (id: number) => new Promise<any>(resolve => lines.on('line', l => { const m = JSON.parse(l); if (m.id === id) resolve(m.result); }));
  const send = (m: object) => child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'naive', version: '0' } } });
  await reply(1);
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/call', params: { name: 'spawn_worker', arguments: {} } });
  const pid = Number((await reply(2)).content[0].text.match(/\d+/)[0]);
  child.stdin!.end();
  await new Promise(r => child.once('close', r));
  await sleep(100);
  try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); return '服务器退出了，子进程还活着（泄漏了）'; } catch { return '子进程已被清理'; }
}

/** 正文对六个场景的结论：两个客户端都必须做到 */
function check(title: string, who: string, lines: string[]) {
  const [first, second] = lines;
  const label = `${title.slice(0, 1)} ${who}`;
  switch (title[0]) {
    case '①': assert.ok(first.startsWith('成功 —— 数完了：5'), `${label}：有进度就不该超时`); break;
    case '②': assert.ok(first.startsWith('失败'), `${label}：没有进度，超时`); assert.ok(second.includes('请求 2 被取消'), `${label}：超时后要通知服务器取消`); break;
    case '③': assert.ok(first.startsWith('失败'), `${label}：用户取消`); assert.ok(second.includes('请求 2 被取消'), `${label}：要通知服务器取消`); break;
    case '④': assert.ok(first.includes('not valid JSON') || first.includes('无法解析'), `${label}：报告坏数据`); assert.ok(second.includes('成功 —— #43'), `${label}：之后的调用照常`); break;
    case '⑤': assert.ok(first.includes('立刻'), `${label}：崩溃时立即失败，而不是等满超时`); break;
    case '⑥': assert.equal(first, '子进程已被清理', `${label}：关闭时清理孙进程`); break;
  }
}

for (const [title, run] of scenarios) {
  console.log(title);
  const lines = await run(pi);
  check(title, 'Pi', lines);
  lines.forEach(line => console.log(`  ${line}`));
  if (title.startsWith('⑥')) {
    const naive = await naiveLeak();
    console.log(`  朴素做法：${naive}`);
    assert.ok(naive.includes('泄漏'), '朴素做法会泄漏子进程');
  }
  console.log();
}
process.exit(0);
