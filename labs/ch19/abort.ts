// 第 19 章实验：abort 的响应说明了什么？取消三个层次，Pi 和 mox-rpc 各自怎么做。
//   node labs/ch19/abort.ts
// ① Agent 正在跑一个要 30 秒的 bash，客户端发出 abort。两个服务端各自在什么时候回复，运行又是怎样结束的？
// ② 运行中直接关闭 stdin（“请退出”），两边是等运行结束，还是中止它？
// ③ 取消传到了最底层吗：30 秒的 bash 命令，是真的被终止了，还是只有“运行”停了？
import assert from 'node:assert/strict';
import { isResponse, label, Link, type Which } from './servers.ts';

async function observe(which: Which) {
  const link = await Link.open(which, '30');
  const began = Date.now();
  link.send({ id: 'p', type: 'prompt', message: '构建项目' });
  await link.until(r => r.type === (which === 'pi' ? 'tool_execution_start' : 'tool_start'));
  const mark = link.received.length;                                   // 这之后的记录，都是 abort 引起的
  const abortedAt = Date.now();
  link.send({ id: 'x', type: 'abort' });
  await link.until(r => isResponse(r) && r.id === 'x', mark);
  const seconds = (Date.now() - abortedAt) / 1000;
  // 收到 abort 的响应，就当作“可以开始下一件事了”：立刻发一条新的 prompt
  link.send({ id: 'q', type: 'prompt', message: '重新构建' });
  const next = (await link.until(r => isResponse(r) && r.id === 'q', mark)).data.disposition;
  await link.until(r => r.type === 'agent_settled', mark);             // 被取消的那次运行结束
  const after = link.received.slice(mark);
  // 被取消的那次运行的关键记录：abort 的响应、第一个 agent_end、第一个 agent_settled
  const first = [after.find(r => isResponse(r) && r.id === 'x'), after.find(r => r.type === 'agent_end'), after.find(r => r.type === 'agent_settled')];
  const key = first.sort((a, b) => after.indexOf(a) - after.indexOf(b));
  const exitCode = await link.close();
  return { key, next, exitCode, seconds, began };
}

/** 运行中关闭 stdin：进程退出之前，有没有等到运行结束（agent_settled） */
async function closeDuringRun(which: Which) {
  const link = await Link.open(which, '1');
  link.send({ id: 'p', type: 'prompt', message: '构建项目' });
  await link.until(r => r.type === (which === 'pi' ? 'tool_execution_start' : 'tool_start'));
  const exitCode = await link.close();
  return { exitCode, settled: link.received.some(r => r.type === 'agent_settled') };
}

const describe = (r: any) => (isResponse(r) ? 'response abort' : r.type === 'agent_end' && r.reason ? `agent_end（reason=${r.reason}）` : r.type === 'agent_settled' && 'aborted' in r ? `agent_settled（aborted=${r.aborted}）` : r.type);

const result = { pi: await observe('pi'), mox: await observe('mox') };

const order = (which: Which) => result[which].key.map(describe).join(' → ');
const closing = { pi: await closeDuringRun('pi'), mox: await closeDuringRun('mox') };
const abortLast = (which: Which) => result[which].key.findIndex(isResponse) === result[which].key.length - 1;
console.log(`| | ${label('pi')} | ${label('mox')} |\n| --- | --- | --- |`);
console.log(`| abort 之后，stdout 上的关键记录依次是 | ${order('pi')} | ${order('mox')} |`);
console.log(`| abort 的响应在运行结束之前还是之后 | ${abortLast('pi') ? '之后' : '之前'} | ${abortLast('mox') ? '之后' : '之前'} |`);
console.log(`| 从 abort 到收到响应 | ${result.pi.seconds < 3 ? '不到 3 秒' : '很久'}（命令本来要跑 30 秒） | ${result.mox.seconds < 3 ? '不到 3 秒' : '很久'}（命令本来要跑 30 秒） |`);
console.log(`| 收到 abort 的响应后立刻发新 prompt，得到 | \`${result.pi.next}\`：开始了新的运行 | \`${result.mox.next}\`：开始了新的运行 |`);
console.log(`| 运行中关闭 stdin，进程退出前收到 agent_settled 吗 | ${closing.pi.settled ? '收到：等运行结束才退出' : '没有：运行被中止，立刻退出'} | ${closing.mox.settled ? '收到：等运行结束才退出' : '没有：运行被中止，立刻退出'} |`);

for (const which of ['pi', 'mox'] as const) {
  assert.ok(abortLast(which), `${which}：先 agent_settled，后 abort 的响应`);
  assert.equal(result[which].next, 'started');
  assert.ok(result[which].seconds < 3, `${which}：取消传到了 bash，30 秒的命令没有跑完`);
  assert.equal(result[which].key.find(r => r.type === 'agent_settled').aborted, true);
}
assert.equal(result.mox.key.find(r => r.type === 'agent_end').reason, 'aborted');
assert.deepEqual([result.pi.exitCode, result.mox.exitCode, closing.pi.exitCode, closing.mox.exitCode], [0, 0, 0, 0]);
assert.equal(closing.pi.settled, false, 'Pi：关闭 stdin 会释放运行时，进行中的运行被中止');
assert.equal(closing.mox.settled, true, 'mox-rpc：关闭 stdin 后等当前运行结束');
