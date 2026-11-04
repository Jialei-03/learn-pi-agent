// 第 19 章实验：同一条 stdout 上的三类记录，响应是不是按发送顺序回来？
//   node labs/ch19/wire.ts
// 真实的 Pi 以 RPC 模式运行（模型是脚本）。客户端在 Agent 运行 bash 的时候，连续发三条命令：
//   bash（要跑 0.4 秒）、get_state、get_messages。看响应按什么顺序回来，以及“按到达顺序认领”会出什么事。
import assert from 'node:assert/strict';
import { isResponse, Link } from './servers.ts';

const SHOWN_EVENTS = new Set(['agent_start', 'tool_execution_start', 'tool_execution_end', 'agent_end', 'agent_settled']);
const fields = (data: any) => `{${Object.keys(data ?? {}).slice(0, 3).join(', ')}${Object.keys(data ?? {}).length > 3 ? ', …' : ''}}`;

// ── 真实 Pi ────────────────────────────────────────────────────
const pi = new Link('pi', '1.5');                       // 脚本里的 bash 跑 1.5 秒：足够长的“运行中”窗口
pi.send({ id: 'a', type: 'get_state' });
await pi.until(r => r.id === 'a');
pi.send({ id: 'p', type: 'prompt', message: '构建项目' });
await pi.until(r => r.type === 'tool_execution_start');
// 运行中：三条命令在同一个时刻连续写入
pi.send({ id: 'b', type: 'bash', command: 'sleep 0.4 && echo hi' });
pi.send({ id: 's', type: 'get_state' });
pi.send({ id: 'm', type: 'get_messages' });
await pi.until(r => r.type === 'agent_settled');

console.log('真实 Pi：stdin 上的命令（→）和 stdout 上的记录（←），按发生顺序\n');
for (const { dir, rec } of pi.log) {
  if (dir === '→') console.log(`→ ${rec.type.padEnd(22)} id=${rec.id}`);
  else if (isResponse(rec)) console.log(`← ${('response ' + rec.command).padEnd(22)} id=${rec.id}  ${rec.success ? '✓' : '✗'}${rec.data?.disposition ? ' ' + rec.data.disposition : ''}`);
  else if (SHOWN_EVENTS.has(rec.type)) console.log(`← ${rec.type.padEnd(22)} （事件，没有 id）`);
}
console.log('\n（message_*、turn_* 等过程事件没有列出：它们的个数每次运行都可能不同。）\n');

const responses = pi.received.filter(isResponse);
const arrival = responses.map(r => r.id);
assert.deepEqual(arrival, ['a', 'p', 's', 'm', 'b'], 'bash 先发，响应却最后到');
const indexOf = (test: (r: any) => boolean) => pi.received.findIndex(test);
assert.ok(indexOf(r => r.id === 'p') < indexOf(r => r.type === 'agent_start'), 'prompt 的响应先于这次运行的第一个事件');
assert.ok(indexOf(r => r.type === 'agent_settled') > indexOf(r => r.id === 'p'), '“收下了”先到，“做完了”后到');
const evented = pi.received.filter(r => !isResponse(r) && 'id' in r);
assert.ok(evented.length > 0 && evented.every(r => r.type === 'bash_execution_update' && r.id === 'b'), '事件里唯一带 id 的是 bash 的输出更新');
console.log('命令发送顺序：b → s → m');
console.log(`响应到达顺序：${arrival.filter(id => 'bsm'.includes(id)).join(' → ')}（慢命令不会堵住后面的快命令）`);
console.log(`事件没有 id，唯一的例外：bash_execution_update（id=${evented[0].id}）\n`);

// 同样三个响应，两种认领方式
const sent = ['b', 's', 'm'];
const byId = new Map(responses.map(r => [r.id, r]));
const fifo = responses.filter(r => sent.includes(r.id));        // 按到达顺序：s, m, b
const names: Record<string, string> = { b: 'bash', s: 'get_state', m: 'get_messages' };
const rows = sent.map((id, i) => `| ${i + 1} | ${names[id]} | ${names[fifo[i].id]} 的数据 ${fields(fifo[i].data)} | ${fields(byId.get(id)!.data)} |`);
console.log('| 发送顺序 | 命令 | 按到达顺序认领（FIFO）得到 | 按 id 认领得到 |\n| --- | --- | --- | --- |\n' + rows.join('\n'));
assert.notEqual(fifo[0].id, 'b', 'FIFO 会把别人的响应交给 bash');

// stdout 只放协议：扩展加载时随手写的 console.log，被 Pi 改道到了 stderr
assert.ok(pi.stderr.includes('[faux-ext]'));
console.log(`\n扩展加载时执行了 console.log，它没有进入 stdout，而是出现在 stderr：\n  ${JSON.stringify(pi.stderr.trim())}`);
await pi.close();

// ── mox：同样的事，但每条命令都是同步处理的 ─────────────────────
const mox = new Link('mox', '1.5');
mox.send({ id: 'p', type: 'prompt', message: '构建项目' });
await mox.until(r => r.type === 'tool_start');
mox.send({ id: 's', type: 'get_state' });
mox.send({ id: 'm', type: 'get_messages' });
mox.send({ id: 'q', type: 'prompt', message: '顺便看看有没有警告' });
await mox.until(r => r.id === 'q');
const moxArrival = mox.received.filter(isResponse).map(r => r.id);
assert.deepEqual(moxArrival, ['p', 's', 'm', 'q']);
console.log(`\nmox：命令发送顺序 s → m → q，响应到达顺序 ${moxArrival.slice(1).join(' → ')}`);
console.log('（同步处理，顺序碰巧一致；协议并不保证，客户端不能依赖）');
await mox.until(r => r.type === 'agent_settled', 0);
await mox.close();

// 背靠背的两条 prompt：第二条到达时，第一条的运行还没来得及登记为“运行中”
const burst = new Link('mox', '0.3');
burst.send({ id: 'p1', type: 'prompt', message: '构建项目' });
burst.send({ id: 'p2', type: 'prompt', message: '顺便看看有没有警告' });
await burst.until(r => r.type === 'agent_settled');
await burst.close();
const dispositions = burst.received.filter(isResponse).map(r => `${r.id}=${r.data.disposition}`);
const starts = burst.received.filter(r => r.type === 'agent_start').length;
assert.deepEqual(dispositions, ['p1=started', 'p2=queued']);
assert.equal(starts, 1, '只有一次运行');
console.log(`mox：同时写入两条 prompt → ${dispositions.join('，')}`);
console.log(`agent_start 出现 ${starts} 次（只有一个运行）`);
