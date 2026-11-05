// 第 19 章实验：真实 Pi 的 abort 的响应说明了什么？取消的三个层次。
//   node labs/ch19/abort.ts
// ① Agent 正在跑一个要 30 秒的 bash，客户端发出 abort。Pi 什么时候回复，运行又是怎样结束的？
// ② 运行中直接关闭 stdin（“请求退出”），是等运行结束，还是中止它？
// ③ 取消传到了最底层吗：30 秒的 bash 命令，是真的被终止了，还是只有“运行”停了？
import assert from 'node:assert/strict';
import { abortLast, closeDuringRun, describe, observe } from './abort-lib.ts';

const pi = await observe('pi');
const closing = await closeDuringRun('pi');
console.log('| 观察 | 真实 Pi |\n| --- | --- |');
console.log(`| abort 之后，stdout 上的关键记录依次是 | ${pi.key.map(describe).join(' → ')} |`);
console.log(`| abort 的响应在运行结束之前还是之后 | ${abortLast(pi.key) ? '之后：收到响应时，会话已经空闲' : '之前'} |`);
console.log(`| 从 abort 到收到响应 | ${pi.seconds < 3 ? '不到 3 秒' : '很久'}（命令本来要跑 30 秒） |`);
console.log(`| 收到 abort 的响应后立刻发新 prompt，得到 | \`${pi.next}\`：开始了新的运行 |`);
console.log(`| 运行中关闭 stdin，进程退出前收到 agent_settled 吗 | ${closing.settled ? '收到：等运行结束才退出' : '没有：运行被中止，立刻退出'} |`);

assert.ok(abortLast(pi.key), 'Pi：先 agent_settled，后 abort 的响应');
assert.equal(pi.next, 'started');
assert.ok(pi.seconds < 3, '取消传到了 bash，30 秒的命令没有跑完');
assert.equal(pi.key.find(r => r.type === 'agent_settled').aborted, true);
assert.deepEqual([pi.exitCode, closing.exitCode], [0, 0]);
assert.equal(closing.settled, false, 'Pi：关闭 stdin 会释放运行时，进行中的运行被中止');
