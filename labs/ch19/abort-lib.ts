// 第 19 章实验共用：观察一次 abort（以及运行中关闭 stdin）的全过程。abort.ts 观察真实的 Pi，practice.ts 观察 mox-rpc。
import { isResponse, Link, type Which } from './servers.ts';

export async function observe(which: Which) {
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
export async function closeDuringRun(which: Which) {
  const link = await Link.open(which, '1');
  link.send({ id: 'p', type: 'prompt', message: '构建项目' });
  await link.until(r => r.type === (which === 'pi' ? 'tool_execution_start' : 'tool_start'));
  const exitCode = await link.close();
  return { exitCode, settled: link.received.some(r => r.type === 'agent_settled') };
}


export const describe = (r: any) => (isResponse(r) ? 'response abort' : r.type === 'agent_end' && r.reason ? `agent_end（reason=${r.reason}）` : r.type === 'agent_settled' && 'aborted' in r ? `agent_settled（aborted=${r.aborted}）` : r.type);
export const abortLast = (key: any[]) => key.findIndex(isResponse) === key.length - 1;
