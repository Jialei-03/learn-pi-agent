// 第 12 章实验：一个能用的 MCP 客户端，要扛住哪些情况？mox 和 Pi 的客户端分别跑同样的六个场景。
//   node labs/ch12/robust.ts
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { McpClient as PiClient, StdioTransport as PiStdio } from '@earendil-works/pi-mcp';
import { McpClient } from '../../mox/src/mcp/client.ts';
import { StdioTransport } from '../../mox/src/mcp/transport.ts';
import { serverCommand } from './shared.ts';

interface Harness {
  call(name: string, args: Record<string, unknown>, options?: { signal?: AbortSignal; timeoutMs?: number; onProgress?: (p: any) => void }): Promise<any>;
  stderr(): string;
  errors: string[];
  close(): Promise<void>;
}

async function mox(env: Record<string, string> = {}): Promise<Harness> {
  const transport = new StdioTransport({ ...serverCommand, env });
  const client = new McpClient(transport);
  const errors: string[] = [];
  client.onError = e => errors.push(e.message);
  await client.connect();
  return { call: (n, a, o) => client.callTool(n, a, o), stderr: () => transport.stderr, errors, close: () => client.close() };
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
  try { return `成功 —— ${text(await p)}`; } catch (e) { return `失败 —— ${(e as Error).message}（${Date.now() - start}ms）`; }
}
const serverSaw = (h: Harness) => h.stderr().split('\n').filter(l => l.includes('取消') || l.includes('crash')).map(l => l.replace('[issues] ', '')).join('；') || '（没有记录）';

const scenarios: [string, (connect: typeof mox) => Promise<string[]>][] = [
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
  ['③ 用户中途取消（200ms 后 abort）', async connect => {
    const h = await connect();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
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

for (const [title, run] of scenarios) {
  console.log(title);
  const [m, p] = [await run(mox), await run(pi)];
  m.forEach((line, i) => {
    console.log(`  mox：${line}`);
    console.log(`  Pi ：${p[i]}`);
  });
  if (title.startsWith('⑥')) console.log(`  朴素：${await naiveLeak()}`);
  console.log();
}
