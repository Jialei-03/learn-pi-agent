// 「你来改」的参考实现：把 mox 的工具执行从“一个接一个”改成“先依次准备，再同时执行”。
// mox/src/loop.ts 的 runLoop 里是 `for (const call of ...) push(await execute(call))`，每个调用从头到尾做完才轮到下一个。
// 这里复制一份 runLoop，只改工具执行那几行：execute 拆成 prepare（找工具、解析参数、beforeTool）和 finish（run、afterTool），
//   1. 所有调用按顺序 prepare —— beforeTool 里可能要弹窗问用户，一次只能问一个；
//   2. 通过的调用同时开始 run，Promise.all 等它们全部结束；
//   3. 结果仍按调用的顺序写进 messages。
import type { Event, LoopOptions, Tool } from '../../mox/src/loop.ts';
import type { Msg, ToolCall } from '../../mox/src/model.ts';

type Prepared = { call: ToolCall; tool?: Tool; args?: any; result?: string };

export async function runLoopParallel(messages: Msg[], options: LoopOptions): Promise<string> {
  const emit = options.onEvent ?? (() => {});
  const push = (message: Msg) => { messages.push(message); emit({ type: 'message', message }); };
  const specs = options.tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
  while (true) {
    await options.compact?.(messages);
    const { message, finish } = await options.model({
      messages: [{ role: 'system', content: options.system }, ...messages],
      tools: specs, signal: options.signal, onText: text => emit({ type: 'text', text }),
    });
    push(message);
    const calls = message.tool_calls ?? [];
    const prepared: Prepared[] = [];
    for (const call of calls) prepared.push(await prepare(call, finish, options, emit));      // 依次准备
    const results = await Promise.all(prepared.map(p => settle(p, options, emit)));         // 同时执行
    calls.forEach((call, i) => push({ role: 'tool', tool_call_id: call.id, content: results[i] })); // 按调用顺序交回
    const steering = options.steer?.() ?? [];
    for (const text of steering) push({ role: 'user', content: text });
    if (!calls.length && !steering.length) return message.content ?? '';
  }
}

async function prepare(call: ToolCall, finish: string, options: LoopOptions, emit: (e: Event) => void): Promise<Prepared> {
  emit({ type: 'tool_start', call });
  try {
    if (options.signal?.aborted) throw new Error('用户取消了');
    if (finish === 'length') throw new Error('输出被截断，参数可能不完整，请重新调用');
    const tool = options.tools.find(t => t.name === call.function.name);
    if (!tool) throw new Error(`没有名为 ${call.function.name} 的工具`);
    const args = JSON.parse(call.function.arguments || '{}');
    const denied = await options.beforeTool?.(tool.name, args);
    if (denied) throw new Error(denied);
    return { call, tool, args };
  } catch (e) {
    return { call, result: `错误：${(e as Error).message}` };                                // 准备阶段就失败：已经有结果了
  }
}

async function settle(p: Prepared, options: LoopOptions, emit: (e: Event) => void): Promise<string> {
  let result = p.result, error = true;
  if (result === undefined) {
    try {
      result = await p.tool!.run(p.args, options.signal);
      result = (await options.afterTool?.(p.tool!.name, p.args, result)) || result;
      error = false;
    } catch (e) {
      result = `错误：${(e as Error).message}`;
    }
  }
  emit({ type: 'tool_end', call: p.call, result, error });
  return result;
}
