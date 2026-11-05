// 第 3 章实验：按下 Esc 之后发生了什么。
//   node labs/ch03/abort.ts
// 模型请求执行一个耗时 2 秒的工具，用户在 100ms 时取消。
// 对比两个工具：一个监听取消信号，一个不理会它。取消是“协作式”的：
// 信号只是一个通知，工具不检查它，就会一直跑完。
import { runAgentLoop } from '@earendil-works/pi-agent-core';
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { obj } from '@earendil-works/pi-schema';

const WORK_MS = 2000;
const ABORT_AT = 100;

/** 一个耗时任务。cooperative=true 时监听取消信号并提前退出。 */
function work(signal: AbortSignal | undefined, cooperative: boolean) {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => resolve('任务完成'), WORK_MS);
    if (cooperative) signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('已取消')); }, { once: true });
  });
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
console.log('| 工具 | 从开始到运行结束 | 工具结果 | 返回的最后一条消息 |');
console.log('| --- | --- | --- | --- |');
for (const cooperative of [true, false]) {
  const p = await withPi(cooperative);
  console.log(`| ${cooperative ? '监听取消信号' : '不理会信号'} | ${Math.round(p.ms / 100) * 100}ms | ${p.tool} | stopReason=${p.reason} |`);
}
