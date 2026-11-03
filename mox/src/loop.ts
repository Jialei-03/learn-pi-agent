// Agent Loop（第 3 章）。
// 结构与 Pi 的 runLoop（packages/agent/src/agent-loop.ts）一一对应：
// 外层循环等 follow-up，内层循环由“工具结果”或“插话”驱动下一轮。
import type { AssistantMessage, Message, Model, StreamEvent, Tool, ToolCall, ToolResultMessage, UserMessage } from './types.ts';
import { runTools, type AgentTool, type ToolEvent, type ToolHooks } from './tools.ts';
import { repairTranscript } from './transcript.ts';

export type EndReason = 'done' | 'error' | 'aborted' | 'host';

export type AgentEvent =
  | { type: 'agent_start' }
  | { type: 'turn_start'; turn: number }
  | { type: 'message'; message: Message }                       // 每条进入上下文的消息
  | { type: 'stream'; event: StreamEvent }                       // 模型的流式输出，给 UI 用
  | ToolEvent                                                    // tool_start / tool_update / tool_end
  | { type: 'turn_end'; turn: number; message: AssistantMessage; toolResults: ToolResultMessage[] }
  | { type: 'agent_end'; reason: EndReason; messages: Message[] };

export interface TurnSummary { turn: number; message: AssistantMessage; toolResults: ToolResultMessage[]; messages: readonly Message[] }

export interface LoopConfig {
  model: Model;
  systemPrompt: string;
  tools: AgentTool[];
  /** 工具执行前后的钩子（第 4 章）。 */
  hooks?: ToolHooks;
  /** 工具默认并行执行；设为 'sequential' 则逐个执行（第 4 章）。 */
  toolExecution?: 'parallel' | 'sequential';
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
  /** 每轮结束时询问宿主：'end' 立即结束；'continue' 保证至少再请求一次；不返回则按正常规则调度。 */
  finishTurn?: (turn: TurnSummary) => 'end' | 'continue' | void;
  /** 两轮之间的准备（第 8 章）：返回新的上下文则替换当前上下文，比如压缩之后的“摘要 + 近期消息”。 */
  prepareNextTurn?: (context: readonly Message[]) => Promise<Message[] | void> | Message[] | void;
  /** 运行中的插话：在每轮结束后读取，下一次请求就能看到。 */
  getSteering?: () => UserMessage[];
  /** 追加任务：只在 agent 本来要结束时读取。 */
  getFollowUp?: () => UserMessage[] | Promise<UserMessage[]>;
}

/** 截断的响应里，工具参数可能只有半截：一个都不执行，告诉模型重新发起。 */
function refuseTruncated(call: ToolCall): ToolResultMessage {
  return {
    role: 'toolResult', toolCallId: call.id, toolName: call.name, isError: true,
    content: `工具 ${call.name} 没有执行：输出达到长度上限，参数可能不完整。请用完整参数重新调用。`,
  };
}

export async function runLoop(history: Message[], prompts: UserMessage[], config: LoopConfig) {
  const context: Message[] = [...history];                       // 每次请求都要发送的完整上下文
  const added: Message[] = [];                                    // 本次运行新增的消息，返回给调用者保存
  const emit = config.onEvent ?? (() => {});
  const tools: Tool[] = config.tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
  const push = (message: Message) => {
    context.push(message);
    added.push(message);
    emit({ type: 'message', message });
  };
  const end = (reason: EndReason) => {
    emit({ type: 'agent_end', reason, messages: added });
    return { reason, messages: added };
  };

  emit({ type: 'agent_start' });
  let pending: UserMessage[] = [...prompts];
  let explicitContinuation = false;
  let turn = 0;

  while (true) {                                                  // 外层：本该结束时，看看还有没有追加任务
    let hasMoreToolCalls = true;
    while (hasMoreToolCalls || pending.length > 0) {              // 内层：工具结果或插话驱动下一轮
      if (turn > 0 && config.prepareNextTurn) {                   // 第 8 章：上下文快满时，在两轮之间压缩
        const replaced = await config.prepareNextTurn(context);
        if (replaced) context.splice(0, context.length, ...replaced);
      }
      for (const message of pending) push(message);
      pending = [];
      emit({ type: 'turn_start', turn: ++turn });

      const reply = await config.model.stream(
        { systemPrompt: config.systemPrompt, messages: repairTranscript(context), tools },   // 发送的是修复后的投影（第 7 章）
        { signal: config.signal, onEvent: event => emit({ type: 'stream', event }) },
      );
      push(reply);

      if (reply.stopReason === 'error' || reply.stopReason === 'aborted') {   // ① 响应本身失败：不执行任何工具
        emit({ type: 'turn_end', turn, message: reply, toolResults: [] });
        return end(reply.stopReason);
      }

      const calls = reply.content.filter((b): b is ToolCall => b.type === 'toolCall');
      const batch = reply.stopReason === 'length'
        ? { results: calls.map(refuseTruncated), terminate: false }  // ② 截断：参数不可信
        : await runTools(calls, config.tools, { signal: config.signal, emit, hooks: config.hooks, mode: config.toolExecution }); // ③ 失败变成 isError 的结果
      for (const result of batch.results) push(result);
      hasMoreToolCalls = batch.results.length > 0 && !batch.terminate; // 整批工具都要求终止时，不再请求模型（第 4 章）

      const decision = config.finishTurn?.({ turn, message: reply, toolResults: batch.results, messages: context }); // ④
      emit({ type: 'turn_end', turn, message: reply, toolResults: batch.results });
      if (decision === 'end') return end('host');

      explicitContinuation = decision === 'continue';
      pending = config.getSteering?.() ?? [];                     // ⑤ 插话：下一轮就带上
      if (hasMoreToolCalls || pending.length > 0) explicitContinuation = false; // 已经会有下一轮，不必额外请求
    }

    const followUps = (await config.getFollowUp?.()) ?? [];       // ⑤ 追加任务：当前工作做完才取
    if (followUps.length > 0) {
      pending = followUps;
      explicitContinuation = false;
      continue;
    }
    if (explicitContinuation) {                                   // 宿主要求“再想一轮”，用原有上下文再请求一次
      explicitContinuation = false;
      continue;
    }
    return end('done');
  }
}
