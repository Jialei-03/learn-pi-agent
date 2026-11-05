// 第 3 章实验：按下 Esc 之后发生了什么。
//   node labs/ch03/abort.ts
// 模型请求执行一个耗时 2 秒的工具，用户在 100ms 时取消。
// 对比两个工具：一个监听取消信号，一个不理会它。取消是“协作式”的：
// 信号只是一个通知，工具不检查它，就会一直跑完。
import { runAgentLoop } from '@earendil-works/pi-agent-core';
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { obj } from '@earendil-works/pi-schema';
import { runLoop, type Tool } from '../../mox/src/loop.ts';
import type { Msg } from '../../mox/src/model.ts';
import { scripted } from '../shared/scripted.ts';

const WORK_MS = 2000;
const ABORT_AT = 100;

/** 一个耗时任务。cooperative=true 时监听取消信号并提前退出。 */
function work(signal: AbortSignal | undefined, cooperative: boolean) {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => resolve('任务完成'), WORK_MS);
    if (cooperative) signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('已取消')); }, { once: true });
  });
}

/** mox：取消时，runLoop 不会返回 —— 下一次请求模型的 fetch 因为 signal 已触发而抛出 AbortError，一路冒出来。 */
async function withMox(cooperative: boolean, calls = 1) {
  const controller = new AbortController();
  const ran: string[] = [];
  const tool: Tool = {
    name: 'long_task', description: '耗时任务', parameters: { type: 'object', properties: {} },
    run: async (_args, signal) => { ran.push('开始'); return work(signal, cooperative); },
  };
  const model = scripted((_messages, n) => (n === 1 ? { toolCalls: Array.from({ length: calls }, () => ({ name: 'long_task', arguments: {} })) } : { text: '完成了。' }));
  const messages: Msg[] = [{ role: 'user', content: '跑一下那个任务' }];
  const start = Date.now();
  setTimeout(() => controller.abort(), ABORT_AT);
  let end = '正常返回';
  try { await runLoop(messages, { model, system: '', tools: [tool], signal: controller.signal }); } catch (e) { end = `抛出 ${(e as Error).name}`; }
  const results = messages.filter(m => m.role === 'tool').map(m => m.content as string);
  return { ms: Date.now() - start, end, results, started: ran.length, tool: `${results[0].startsWith('错误：') ? '错误' : '成功'}：${results[0].replace(/^错误：/, '')}` };
}

async function withPi(cooperative: boolean) {
  const controller = new AbortController();
  const faux = createFauxCore({});
  faux.setResponses([
    () => fauxAssistantMessage(fauxToolCall('long_task', {}, { id: 't1' }), { stopReason: 'toolUse' }),
    () => fauxAssistantMessage('完成了。'),
  ]);
  const tool = {
    name: 'long_task', label: 'long_task', description: '耗时任务', parameters: obj({}),
    async execute(_id: string, _args: unknown, signal?: AbortSignal) {
      return { content: [{ type: 'text' as const, text: await work(signal, cooperative) }], details: undefined };
    },
  };
  const start = Date.now();
  setTimeout(() => controller.abort(), ABORT_AT);
  const added = await runAgentLoop(
    [{ role: 'user', content: '跑一下那个任务', timestamp: 0 }],
    { messages: [], tools: [tool] },
    { model: faux.getModel(), convertToLlm: m => m as any },
    () => {}, controller.signal,
    (m, c, o) => faux.streamSimple(m, c, o),
  );
  const result: any = added.find((m: any) => m.role === 'toolResult');
  const last: any = added.at(-1);
  return { ms: Date.now() - start, reason: last?.stopReason, tool: result && `${result.isError ? '错误' : '成功'}：${result.content[0]?.text}` };
}

console.log(`工具需要 ${WORK_MS}ms，用户在 ${ABORT_AT}ms 时取消。\n`);
console.log('| 实现 | 工具 | 从开始到运行结束 | 工具结果 | 运行怎样收场 |');
console.log('| --- | --- | --- | --- | --- |');
for (const cooperative of [true, false]) {
  const label = cooperative ? '监听取消信号' : '不理会信号';
  const m = await withMox(cooperative);
  console.log(`| mox | ${label} | ${Math.round(m.ms / 100) * 100}ms | ${m.tool} | runLoop ${m.end} |`);
  const p = await withPi(cooperative);
  console.log(`| Pi | ${label} | ${Math.round(p.ms / 100) * 100}ms | ${p.tool} | 返回的最后一条消息 stopReason=${p.reason} |`);
}

// 一条回复里有两个调用时：取消发生在第一个调用运行期间，第二个调用根本不会开始，但它也有一条结果
const two = await withMox(true, 2);
console.log(`\n一条回复里请求了两次 long_task，${ABORT_AT}ms 时取消：真正开始运行的有 ${two.started} 次；`);
console.log(`历史里的两条工具结果：${two.results.map(r => JSON.stringify(r)).join('、')}`);
