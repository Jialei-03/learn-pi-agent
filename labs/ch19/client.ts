// 第 19 章实验：用 Pi 自带的 RpcClient，同时驱动真实的 Pi 和 labs/ch19/mox-rpc.ts。
//   node labs/ch19/client.ts
// RpcClient 是正文里读的那份客户端代码（packages/coding-agent/src/modes/rpc/rpc-client.ts）。
// mox-rpc 只实现了 prompt、abort、get_state、get_messages 四条命令，但协议的骨架（id、响应、事件）和 Pi 一致，所以这个客户端可以直接驱动它。
import assert from 'node:assert/strict';
import { RpcClient } from '@earendil-works/pi-coding-agent';
import { label, serverConfig, type Which } from './servers.ts';

// RpcClient 会把子进程的 stderr 转发到自己的 stderr；实验只关心 stdout 上的协议，这里把转发吞掉
process.stderr.write = (() => true) as typeof process.stderr.write;

const textOf = (m: any) => (typeof m.content === 'string' ? m.content : m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''));

async function run(which: Which) {
  const config = await serverConfig(which, '0.3');
  const client = new RpcClient({ cliPath: config.cliPath, cwd: config.cwd, env: config.env, args: config.args });
  await client.start();

  // ① promptAndWait 展开：先装监听器，再发 prompt，等 agent_settled
  const eventsPromise = client.collectEvents();
  const disposition = await client.prompt('构建项目');
  const events = await eventsPromise;
  const messages = await client.getMessages();
  const last = messages.filter((m: any) => m.role === 'assistant').at(-1);

  // ② 服务端没实现的命令：得到一个 success: false 的响应，RpcClient 把它变成异常
  const unsupported = await client.getLastAssistantText().then(text => `✓ ${JSON.stringify(text)}`, (e: Error) => `✗ ${e.message}`);

  // ③ 一行写坏的命令：服务端回复一条没有 id 的 response（command: "parse"）。RpcClient 的 handleLine 找不到等它的请求，把它当事件交给监听器
  const seen: any[] = [];
  const off = client.onEvent(e => seen.push(e));
  (client as any).process.stdin.write('{"id": "9", "type": "prompt", "message": \n');
  for (let i = 0; i < 200 && !seen.length; i++) await new Promise(r => setTimeout(r, 25));
  off();

  // ③' 同一个事件交给两个监听器，第一个抛异常：handleLine 的 try/catch 把异常吞掉，第二个监听器收不到这个事件
  let thrown = false;
  const afterThrow: any[] = [];
  const off1 = client.onEvent(() => { thrown = true; throw new Error('监听器自己出错了'); });
  const off2 = client.onEvent(e => afterThrow.push(e));
  (client as any).process.stdin.write('{"id": "10", "type": "prompt", "message": \n');
  for (let i = 0; i < 200 && !thrown; i++) await new Promise(r => setTimeout(r, 25));
  await new Promise(r => setTimeout(r, 100));
  off1(); off2();

  // ④ 子进程在命令还没回复时崩溃：等待中的请求立刻失败，而不是各自等满 30 秒超时（mox 没有耗时命令，跳过）
  let crash = '—（mox 没有耗时的命令）';
  if (which === 'pi') {
    const pending = client.bash('echo started; sleep 3');
    await new Promise<void>(resolve => { const off2 = client.onEvent(e => { if (e.type === 'bash_execution_update') { off2(); resolve(); } }); });
    (client as any).process.kill('SIGKILL');
    crash = await pending.then(() => '（没有失败？）', (e: Error) => `✗ ${e.message.split('. Stderr')[0]}`);
  }
  await client.stop();
  config.close();
  return { disposition, events, finalText: last && textOf(last), unsupported, parse: seen[0], thrown, afterThrow: afterThrow.length, crash };
}

const pi = await run('pi');
const mox = await run('mox');
const row = (name: string, f: (r: typeof pi) => string) => `| ${name} | ${f(pi)} | ${f(mox)} |`;
console.log(`| RpcClient 的调用 | ${label('pi')} | ${label('mox')} |\n| --- | --- | --- |`);
console.log(row('prompt() 返回', r => `\`${r.disposition}\``));
console.log(row('collectEvents() 以 agent_settled 结束', r => (r.events.at(-1)?.type === 'agent_settled' ? '是' : '否')));
console.log(row('getMessages() 里最后一条助手消息', r => JSON.stringify(r.finalText)));
console.log(row('getLastAssistantText()', r => r.unsupported));
console.log(row('写坏的一行，监听器收到', r => `\`{type: "${r.parse.type}", command: "${r.parse.command}", success: ${r.parse.success}}\``));
console.log(row('第一个监听器抛异常，第二个监听器还能收到这个事件吗', r => (r.afterThrow ? '能' : '不能')));
console.log(row('命令挂起时进程被杀，bash() 的结果', r => r.crash));

assert.equal(pi.disposition, 'started');
assert.equal(mox.disposition, 'started');
assert.equal(pi.events.at(-1)?.type, 'agent_settled');
assert.equal(mox.events.at(-1)?.type, 'agent_settled');
assert.equal(pi.finalText, '构建完成。');
assert.equal(mox.finalText, '构建完成。');
assert.match(pi.unsupported, /^✓/);
assert.match(mox.unsupported, /^✗ 未知命令/);
for (const r of [pi, mox]) assert.deepEqual([r.parse.type, r.parse.command, r.parse.success], ['response', 'parse', false]);
for (const r of [pi, mox]) assert.deepEqual([r.thrown, r.afterThrow], [true, 0]);
assert.match(pi.crash, /Agent process exited/);
