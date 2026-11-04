// 第 19 章实验：abort 的响应说明了什么？
//   node labs/ch19/abort.ts
// ① Agent 正在跑一个要 30 秒的 bash，客户端发出 abort。真实的 Pi 和 mox 各自在什么时候回复，运行又是怎样结束的？
// ② 运行中直接关闭 stdin（“请退出”），两边是等运行结束，还是中止它？
import assert from 'node:assert/strict';
import { isResponse, label, Link, type Which } from './servers.ts';

async function observe(which: Which) {
  const link = new Link(which, '30');
  link.send({ id: 'p', type: 'prompt', message: '构建项目' });
  await link.until(r => r.type === (which === 'pi' ? 'tool_execution_start' : 'tool_start'));
  const mark = link.received.length;                                   // 这之后的记录，都是 abort 引起的
  link.send({ id: 'x', type: 'abort' });
  await link.until(r => isResponse(r) && r.id === 'x', mark);
  // 收到 abort 的响应，就当作“可以开始下一件事了”：立刻发一条新的 prompt
  link.send({ id: 'q', type: 'prompt', message: '重新构建' });
  const next = (await link.until(r => isResponse(r) && r.id === 'q', mark)).data.disposition;
  await link.until(r => r.type === 'agent_settled', mark);             // 被取消的那次运行结束（mox 要到这时才结束）
  const after = link.received.slice(mark);
  // 被取消的那次运行的关键记录：abort 的响应、第一个 agent_end、第一个 agent_settled
  const first = [after.find(r => isResponse(r) && r.id === 'x'), after.find(r => r.type === 'agent_end'), after.find(r => r.type === 'agent_settled')];
  const key = first.sort((a, b) => after.indexOf(a) - after.indexOf(b));
  const exitCode = await link.close();
  return { after, key, next, exitCode };
}

/** 运行中关闭 stdin：进程退出之前，有没有等到运行结束（agent_settled） */
async function closeDuringRun(which: Which) {
  const link = new Link(which, '1');
  link.send({ id: 'p', type: 'prompt', message: '构建项目' });
  await link.until(r => r.type === (which === 'pi' ? 'tool_execution_start' : 'tool_start'));
  const exitCode = await link.close();
  return { exitCode, settled: link.received.some(r => r.type === 'agent_settled') };
}

const describe = (r: any) => (isResponse(r) ? 'response abort' : r.type === 'agent_end' && r.reason ? `agent_end（reason=${r.reason}）` : r.type === 'agent_settled' && 'aborted' in r ? `agent_settled（aborted=${r.aborted}）` : r.type);

const result = { pi: await observe('pi'), mox: await observe('mox') };

const order = (which: Which) => result[which].key.map(describe).join(' → ');
console.log(`| | ${label('pi')} | ${label('mox')} |\n| --- | --- | --- |`);
console.log(`| abort 之后，stdout 上的关键记录依次是 | ${order('pi')} | ${order('mox')} |`);
const at = (which: Which, test: (r: any) => boolean) => result[which].key.findIndex(test);
const piAbortLast = at('pi', isResponse) > at('pi', r => r.type === 'agent_settled');
const moxAbortFirst = at('mox', isResponse) < at('mox', r => r.type === 'agent_end');
console.log(`| abort 的响应在运行结束之前还是之后 | ${piAbortLast ? '之后' : '之前'} | ${moxAbortFirst ? '之前' : '之后'} |`);
console.log(`| 响应的含义 | 会话已经空闲，可以立刻发下一条 prompt | 取消信号已经发出，运行还要一会儿才结束 |`);
console.log(`| 收到 abort 的响应后立刻发新 prompt，得到 | \`${result.pi.next}\`：开始了新的运行 | \`${result.mox.next}\`：当成插话排队，没有新运行开始 |`);
const closing = { pi: await closeDuringRun('pi'), mox: await closeDuringRun('mox') };
console.log(`| 运行中关闭 stdin，进程退出前收到 agent_settled 吗 | ${closing.pi.settled ? '收到：等运行结束才退出' : '没有：运行被中止，立刻退出'} | ${closing.mox.settled ? '收到：等运行结束才退出' : '没有：运行被中止，立刻退出'} |`);

assert.ok(piAbortLast, 'Pi：先 agent_settled，后 abort 的响应');
assert.ok(moxAbortFirst, 'mox：abort 的响应先于运行结束');
assert.equal(result.pi.next, 'started');
assert.equal(result.mox.next, 'queued');
assert.equal(result.pi.key.find(r => r.type === 'agent_settled').aborted, true);
assert.equal(result.mox.key.find(r => r.type === 'agent_end').reason, 'aborted');
assert.deepEqual([result.pi.exitCode, result.mox.exitCode, closing.pi.exitCode, closing.mox.exitCode], [0, 0, 0, 0]);
assert.equal(closing.pi.settled, false, 'Pi：关闭 stdin 会释放运行时，进行中的运行被中止');
assert.equal(closing.mox.settled, true, 'mox：关闭 stdin 后等当前运行结束');
