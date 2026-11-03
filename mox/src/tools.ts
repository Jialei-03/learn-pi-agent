// 工具流水线（第 3 章引入，第 4 章完善）。
// 一个工具调用依次经过：找到工具 → 参数修正 → 参数校验 → 执行前钩子 → 执行 → 执行后钩子 → 结果消息。
// 对照 Pi：packages/agent/src/agent-loop.ts（prepareToolCall、executePreparedToolCall、finalizeExecutedToolCall）。
import type { Tool, ToolCall, ToolResultMessage } from './types.ts';
import { coerce, formatValidationError, validate, type Schema } from './schema.ts';

export interface ToolResult {
  content: string;
  isError?: boolean;        // 不抛异常也能报告失败
  terminate?: boolean;      // 建议这一批工具执行完就结束运行（整批都同意才生效）
  details?: unknown;        // 给界面和日志看的结构化数据，不发给模型
}

export interface ToolContext {
  toolCallId: string;
  signal?: AbortSignal;
  onUpdate?: (partial: string) => void; // 长时间运行的工具可以先报告部分输出
}

export interface AgentTool extends Tool {
  /** 'sequential'：这个工具不能和其他工具同时执行。 */
  executionMode?: 'parallel' | 'sequential';
  /** 重放安全（第 18 章）：执行到一半进程崩溃了，恢复时可以直接再执行一遍（只读、幂等的工具） */
  replaySafe?: boolean;
  /** 兼容垫片：在校验之前修正模型常见的参数格式错误。 */
  prepareArguments?: (args: Record<string, unknown>) => Record<string, unknown>;
  execute(args: Record<string, any>, context: ToolContext): Promise<string | ToolResult> | string | ToolResult;
}

export interface ToolHooks {
  /** 执行前：可以拦下这次调用。被拦下的调用变成一条错误结果。 */
  beforeToolCall?: (call: ToolCall, args: Record<string, unknown>) => Promise<{ block: true; reason?: string } | void> | { block: true; reason?: string } | void;
  /** 执行后：可以逐字段改写结果（比如隐去密钥）。 */
  afterToolCall?: (call: ToolCall, args: Record<string, unknown>, result: ToolResult) => Promise<Partial<ToolResult> | void> | Partial<ToolResult> | void;
}

export type ToolEvent =
  | { type: 'tool_start'; toolCall: ToolCall }
  | { type: 'tool_update'; toolCall: ToolCall; partial: string }
  | { type: 'tool_end'; result: ToolResultMessage; durationMs?: number };

export interface RunToolsOptions {
  signal?: AbortSignal;
  emit: (event: ToolEvent) => void;
  hooks?: ToolHooks;
  /** 全局执行模式；默认并行。只要这一批里有一个工具要求串行，整批就串行。 */
  mode?: 'parallel' | 'sequential';
}

type Prepared =
  | { kind: 'immediate'; call: ToolCall; result: ToolResult }
  | { kind: 'ready'; call: ToolCall; tool: AgentTool; args: Record<string, unknown> };

/** 前半段：找工具、修正、校验、执行前钩子。任何一步失败都直接得到一条错误结果，不会执行。 */
async function prepare(call: ToolCall, tools: AgentTool[], hooks: ToolHooks | undefined, signal?: AbortSignal): Promise<Prepared> {
  const tool = tools.find(t => t.name === call.name);
  if (!tool) return { kind: 'immediate', call, result: { content: `没有名为 ${call.name} 的工具`, isError: true } };
  try {
    // 复制一份：工具或钩子修改参数时，不能改到历史里那条 toolCall（否则下次请求的前缀就变了）
    const raw = structuredClone(call.arguments);
    const prepared = tool.prepareArguments ? tool.prepareArguments(raw) : raw;
    const args = coerce(tool.parameters as Schema, prepared) as Record<string, unknown>;   // 宽进
    const errors = validate(tool.parameters as Schema, args);                              // 严出
    if (errors.length) return { kind: 'immediate', call, result: { content: formatValidationError(call.name, errors, call.arguments), isError: true } };
    const verdict = await hooks?.beforeToolCall?.(call, args);
    if (signal?.aborted) return { kind: 'immediate', call, result: { content: '已取消', isError: true } };
    if (verdict?.block) return { kind: 'immediate', call, result: { content: verdict.reason ?? '工具调用被拦截', isError: true } };
    return { kind: 'ready', call, tool, args };
  } catch (error) {
    return { kind: 'immediate', call, result: { content: (error as Error).message, isError: true } };
  }
}

/** 后半段：执行、执行后钩子。异常一律变成错误结果。 */
async function execute(p: Extract<Prepared, { kind: 'ready' }>, hooks: ToolHooks | undefined, opts: RunToolsOptions) {
  const started = performance.now();
  let result: ToolResult;
  try {
    const out = await p.tool.execute(p.args, {
      toolCallId: p.call.id, signal: opts.signal,
      onUpdate: partial => opts.emit({ type: 'tool_update', toolCall: p.call, partial }),
    });
    result = typeof out === 'string' ? { content: out } : out;
  } catch (error) {
    result = { content: error instanceof Error ? error.message : String(error), isError: true };
  }
  try {
    const patch = await hooks?.afterToolCall?.(p.call, p.args, result);
    if (patch) result = { ...result, ...patch };
  } catch (error) {
    result = { content: (error as Error).message, isError: true };
  }
  return { result, durationMs: Math.round(performance.now() - started) };
}

function toMessage(call: ToolCall, result: ToolResult): ToolResultMessage {
  return { role: 'toolResult', toolCallId: call.id, toolName: call.name, content: result.content, isError: result.isError === true };
}

/**
 * 执行一批工具调用。
 * 并行模式：按顺序做准备（校验、钩子），再同时执行；结果仍按调用顺序返回。
 * 串行模式：一个做完再做下一个。
 */
export async function runTools(calls: ToolCall[], tools: AgentTool[], opts: RunToolsOptions): Promise<{ results: ToolResultMessage[]; terminate: boolean }> {
  const sequential = opts.mode === 'sequential' || calls.some(c => tools.find(t => t.name === c.name)?.executionMode === 'sequential');
  const finals: ToolResult[] = [];
  const results: ToolResultMessage[] = [];

  if (sequential) {
    for (const call of calls) {
      opts.emit({ type: 'tool_start', toolCall: call });
      const p = await prepare(call, tools, opts.hooks, opts.signal);
      const { result, durationMs } = p.kind === 'immediate' ? { result: p.result, durationMs: undefined } : await execute(p, opts.hooks, opts);
      const message = toMessage(call, result);
      opts.emit({ type: 'tool_end', result: message, durationMs });
      finals.push(result);
      results.push(message);
      if (opts.signal?.aborted) break;
    }
  } else {
    const pending: Promise<ToolResult>[] = [];
    for (const call of calls) {
      opts.emit({ type: 'tool_start', toolCall: call });
      const p = await prepare(call, tools, opts.hooks, opts.signal);  // 准备阶段仍然按顺序：钩子可能要弹窗问用户
      pending.push(p.kind === 'immediate'
        ? Promise.resolve(p.result).then(r => { opts.emit({ type: 'tool_end', result: toMessage(call, r) }); return r; })
        : execute(p, opts.hooks, opts).then(({ result, durationMs }) => { opts.emit({ type: 'tool_end', result: toMessage(call, result), durationMs }); return result; }));
    }
    const settled = await Promise.all(pending);                      // 完成顺序不定，但结果按调用顺序排列
    settled.forEach((r, i) => { finals.push(r); results.push(toMessage(calls[i], r)); });
  }

  // 只有整批都要求终止才终止；注意空数组的 every() 也是 true，所以要先判断长度
  const terminate = finals.length > 0 && finals.every(r => r.terminate === true);
  return { results, terminate };
}
