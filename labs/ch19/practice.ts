// 第 19 章实战检验：把 mox 当库用，再在 runLoop 之上写一个最小 RPC（mox-rpc.ts）。
//   node labs/ch19/practice.ts                      检验参考实现（mox/ 和 labs/ch19/mox-rpc.ts）
//   MOX_DIR=~/my-mox node labs/ch19/practice.ts     检验你自己的 mox；如果 ~/my-mox/rpc.ts 存在，RPC 也用你写的那份
// 五部分：① library.ts 当库用；② print.ts 的 mox -p；③ RPC 的响应顺序和背靠背的 prompt；④ abort 的响应；⑤ 用 Pi 自带的 RpcClient 驱动它。
import assert from 'node:assert/strict';
import { RpcClient } from '@earendil-works/pi-coding-agent';
import { whose } from '../shared/mox-dir.ts';
import { abortLast, closeDuringRun, describe, observe } from './abort-lib.ts';
import { isResponse, Link, serverConfig } from './servers.ts';

console.log(`${whose()}\n`);
console.log('══════ ① 当库用 ══════\n');
await import('./library.ts');
console.log('\n══════ ② mox -p ══════\n');
await import('./print.ts');

// ③ 响应顺序：运行中连发 get_state、get_messages、prompt
console.log('\n══════ ③ RPC：响应与插话 ══════\n');
const mox = await Link.open('mox', '1.5');
mox.send({ id: 'p', type: 'prompt', message: '构建项目' });
await mox.until(r => r.type === 'tool_start');
mox.send({ id: 's', type: 'get_state' });
mox.send({ id: 'm', type: 'get_messages' });
mox.send({ id: 'q', type: 'prompt', message: '顺便看看有没有警告' });
await mox.until(r => r.id === 'q');
const arrival = mox.received.filter(isResponse).map(r => r.id);
const disposition = mox.received.find(r => r.id === 'q').data.disposition;
await mox.until(r => r.type === 'agent_settled', 0);
await mox.close();
console.log(`命令发送顺序 p → s → m → q，响应到达顺序 ${arrival.join(' → ')}；运行中的 prompt 得到 \`${disposition}\``);
assert.deepEqual(arrival, ['p', 's', 'm', 'q']);
assert.equal(disposition, 'queued', '运行中的 prompt 是插话，不是第二个运行');

// 背靠背的两条 prompt：第二条到达时，第一条必须已经把“正在运行”标记好
const burst = await Link.open('mox', '0.3');
burst.send({ id: 'p1', type: 'prompt', message: '构建项目' });
burst.send({ id: 'p2', type: 'prompt', message: '顺便看看有没有警告' });
await burst.until(r => r.type === 'agent_settled');
await burst.close();
const dispositions = burst.received.filter(isResponse).map(r => `${r.id}=${r.data.disposition}`);
const starts = burst.received.filter(r => r.type === 'agent_start').length;
console.log(`同时写入两条 prompt → ${dispositions.join('，')}；agent_start 出现 ${starts} 次`);
assert.deepEqual(dispositions, ['p1=started', 'p2=queued']);
assert.equal(starts, 1, '只有一个运行');

// ④ abort
console.log('\n══════ ④ abort ══════\n');
const aborted = await observe('mox');
const closing = await closeDuringRun('mox');
console.log(`abort 之后的关键记录：${aborted.key.map(describe).join(' → ')}`);
console.log(`收到 abort 的响应后立刻发新 prompt 得到 \`${aborted.next}\`；30 秒的命令 ${aborted.seconds.toFixed(1)} 秒就停了；运行中关闭 stdin ${closing.settled ? '会等运行结束再退出' : '会中止运行'}`);
assert.ok(abortLast(aborted.key), 'abort 的响应在运行收尾之后才回复');
assert.equal(aborted.next, 'started');
assert.ok(aborted.seconds < 3, '取消传到了 bash');
assert.equal(aborted.key.find(r => r.type === 'agent_end').reason, 'aborted');
assert.equal(closing.settled, true, '关闭 stdin：等当前运行结束');

// ⑤ Pi 自带的客户端驱动它
console.log('\n══════ ⑤ 用 Pi 的 RpcClient 驱动 ══════\n');
process.stderr.write = (() => true) as typeof process.stderr.write;
const config = await serverConfig('mox', '0.3');
const client = new RpcClient({ cliPath: config.cliPath, cwd: config.cwd, env: config.env, args: config.args });
await client.start();
const events = client.collectEvents();
const how = await client.prompt('构建项目');
const settled = await events;
const last = (await client.getMessages()).filter((m: any) => m.role === 'assistant').at(-1) as any;
const text = typeof last.content === 'string' ? last.content : last.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
const unsupported = await client.getLastAssistantText().then(() => '支持', (e: Error) => e.message);
await client.stop();
config.close();
console.log(`prompt() 返回 \`${how}\`；事件以 \`${settled.at(-1)?.type}\` 结束；最后一条助手消息：${JSON.stringify(text)}；没实现的命令：${unsupported}`);
assert.equal(how, 'started');
assert.equal(settled.at(-1)?.type, 'agent_settled');
assert.equal(text, '构建完成。');
assert.match(unsupported, /未知命令/);
