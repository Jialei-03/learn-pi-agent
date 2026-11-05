// 第 12 章实验：mox 的 MCP 客户端的边界——同样的场景，Pi 的客户端怎么做。
//   node labs/ch12/edges.ts
// mox 这一侧是真正的 connectMcp 加上它产生的 mox 工具；Pi 这一侧是 @earendil-works/pi-mcp 的 McpClient。
// 服务器都是 labs/fixtures/mcp-server.ts，用环境变量让它做出各种“不规矩”的事。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpClient as PiClient, StdioTransport as PiStdio } from '@earendil-works/pi-mcp';
import { connectMcp } from '../../mox/src/mcp.ts';
import { serverCommand } from './shared.ts';

const TEE = join(import.meta.dirname, '../fixtures/mcp-tee.ts');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const text = (r: any) => r.content.map((c: any) => c.text).join('');
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** 两边用同一套接口：list() 取工具名，call() 调用，close() 关闭。 */
interface Side { list(): Promise<string[]>; call(name: string, args?: object, signal?: AbortSignal): Promise<string>; close(): Promise<void> }

/** wireLog：给了就在 mox 和服务器之间插上 tee，把线路上的每一行记进这个文件。 */
async function mox(env: Record<string, string> = {}, wireLog?: string): Promise<Side & { warnings: string[] }> {
  const warnings: string[] = [];
  const command = wireLog ? { command: process.execPath, args: [TEE, wireLog, serverCommand.command, ...serverCommand.args] } : serverCommand;
  const mcp = await connectMcp({ issues: { ...command, env } }, m => warnings.push(m));
  const tool = (name: string) => mcp.tools.find(t => t.name === `mcp__issues__${name}`) ?? (() => { throw new Error(`没有工具 ${name}`); })();
  return { warnings, list: async () => mcp.tools.map(t => t.name), call: async (name, args = {}, signal) => String(await tool(name).run(args, signal)), close: async () => mcp.close() };
}

async function pi(env: Record<string, string> = {}): Promise<Side & { warnings: string[] }> {
  const transport = new PiStdio({ ...serverCommand, env });
  const client = new PiClient({ name: 'lab', version: '1.0.0' });
  await client.connect(transport);
  return {
    warnings: [], list: async () => (await client.listTools()).map(t => t.name),
    call: async (name, args = {}, signal) => { const r = await client.callTool(name, args, { signal }); if (r.isError) throw new Error(text(r) || 'isError'); return text(r); },
    close: () => client.close(),
  };
}

async function outcome(p: Promise<unknown>) {
  const start = Date.now();
  const took = () => { const ms = Date.now() - start; return ms < 80 ? '立刻' : `约 ${Math.round(ms / 100) * 100}ms`; };
  try { const value = String(await p).slice(0, 30); return `成功：${value}（${took()}）`; } catch (e) { return `失败：${(e as Error).message.slice(0, 40)}（${took()}）`; }
}

const rows: [string, string, string][] = [];
const record = (scenario: string, m: string, p: string) => rows.push([scenario, m, p]);

// A 工具列表分页
{
  const [m, p] = [await mox({ MCP_FIXTURE_PAGE_SIZE: '3' }), await pi({ MCP_FIXTURE_PAGE_SIZE: '3' })];
  const [mn, pn] = [(await m.list()).length, (await p.list()).length];
  record('A. 服务器分页返回工具（每页 3 个，共 8 个）', `拿到 ${mn} 个`, `拿到 ${pn} 个`);
  await m.close(); await p.close();
  assert.equal(mn, 3); assert.equal(pn, 8);
}

// B 服务器给客户端发请求
{
  const m = await mox({ MCP_FIXTURE_PING: '1' });
  const p = await pi({ MCP_FIXTURE_PING: '1' });
  record('B. 握手后服务器发来一个 ping 请求（id 恰好是 2）', m.warnings[0]?.replace('MCP 服务器 issues ', '') ?? '正常', `连接正常，${(await p.list()).length} 个工具`);
  await m.close(); await p.close();
  assert.match(m.warnings[0], /连接失败/);
}

// C 用户中途取消（250ms 后 abort；任务要 1 秒）
{
  const dir = mkdtempSync(join(tmpdir(), 'ch12-edges-'));
  const log = join(dir, 'wire.log');
  const run = async (side: Side) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 250);
    const r = await outcome(side.call('slow_count', { to: 10, delayMs: 100 }, controller.signal));
    await sleep(200);                                  // 让 tee 来得及把取消通知记进日志
    await side.close();
    return r;
  };
  const mr = await run(await mox({}, log));
  const cancelled = readFileSync(log, 'utf8').split('\n').filter(l => l.includes('notifications/cancelled'));
  const pr = await run(await pi());
  record('C. 工具要 1 秒，用户 250ms 后按 Ctrl+C', `${mr}；线路上${cancelled.length ? '发出了 notifications/cancelled' : '没有 notifications/cancelled'}`, pr);
  rmSync(dir, { recursive: true, force: true });
  assert.match(mr, /已取消/); assert.equal(cancelled.length, 1); assert.match(pr, /失败/);
}

// D 服务器崩溃之后，再调用一次
{
  const run = async (side: Side) => {
    const crash = await outcome(side.call('crash'));
    const next = await Promise.race([outcome(side.call('search_issues', { query: '' })), sleep(1500).then(() => '1.5 秒后仍然没有任何结果（挂住了）')]);
    await side.close();
    return `崩溃那次 ${crash.replace(/（.*/, '')}；再调用一次：${next}`;
  };
  const [mr, pr] = [await run(await mox()), await run(await pi())];
  record('D. 服务器崩溃（调用 crash），之后再调用一个工具', mr, pr);
  assert.match(mr, /已退出.*立刻/); assert.doesNotMatch(mr, /挂住了/);
}

// E 服务器启动了子进程，客户端关闭连接
{
  const run = async (side: Side) => {
    const pid = Number((await side.call('spawn_worker')).match(/\d+/)![0]);
    await side.close();
    await sleep(300);
    const left = alive(pid);
    if (left) process.kill(pid, 'SIGKILL');
    return left ? '子进程还活着（泄漏）' : '子进程已被清理';
  };
  const [mr, pr] = [await run(await mox()), await run(await pi())];
  record('E. 服务器启动了子进程，客户端 close', mr, pr);
  assert.match(mr, /泄漏/); assert.match(pr, /清理/);
}

// F 服务器把日志打进了 stdout
{
  const [m, p] = [await mox({ MCP_FIXTURE_NOISY: '1' }), await pi({ MCP_FIXTURE_NOISY: '1' })];
  const [mr, pr] = [await outcome(m.call('search_issues', { query: 'MCP' })), await outcome(p.call('search_issues', { query: 'MCP' }))];
  record('F. 服务器启动时往 stdout 打了一行普通日志', mr, pr);
  await m.close(); await p.close();
  assert.match(mr, /成功/); assert.match(pr, /成功/);
}

console.log('| 场景 | mox | Pi |');
console.log('| --- | --- | --- |');
for (const [scenario, m, p] of rows) console.log(`| ${scenario} | ${m} | ${p} |`);
process.exit(0);
