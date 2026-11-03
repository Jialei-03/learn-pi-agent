// mox 的内部消息格式（第 2 章引入）。
// 字段名刻意与 Pi 的 packages/ai/src/types.ts 保持一致：toolCall、toolResult、stopReason……
// 读 Pi 源码时，你会发现自己已经认识这些结构。

export interface TextContent { type: 'text'; text: string }
export interface ToolCall { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> }

/** 归一化后的停止原因。每家服务商的原始值保存在 rawStopReason 里。 */
export type StopReason = 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';

export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }

export interface UserMessage { role: 'user'; content: string }
export interface AssistantMessage {
  role: 'assistant';
  content: (TextContent | ToolCall)[];
  stopReason: StopReason;
  rawStopReason?: string;
  errorMessage?: string;
  usage: Usage;
}
export interface ToolResultMessage { role: 'toolResult'; toolCallId: string; toolName: string; content: string; isError: boolean }
export type Message = UserMessage | AssistantMessage | ToolResultMessage;

/** 交给模型的工具说明。parameters 是 JSON Schema。 */
export interface Tool { name: string; description: string; parameters: Record<string, unknown> }

/** 一次模型请求的全部输入。模型是无状态的：每次都要带上完整的 messages。 */
export interface Context { systemPrompt: string; messages: Message[]; tools: Tool[] }

/** 流式事件。UI 用它实时显示；循环只关心最后的 AssistantMessage。 */
export type StreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'toolcall_start'; id: string; name: string }
  | { type: 'toolcall_delta'; id: string; delta: string; preview: Record<string, unknown> | undefined }
  | { type: 'toolcall_end'; toolCall: ToolCall }
  | { type: 'done'; message: AssistantMessage };

export interface StreamOptions { signal?: AbortSignal; onEvent?: (event: StreamEvent) => void }

/**
 * 一个模型 = 一个把 Context 变成 AssistantMessage 的函数。
 * 约定：stream() 不抛异常。网络错误、HTTP 错误、取消都编码进返回消息的 stopReason / errorMessage，
 * 这样循环只需要处理一种返回值（Pi 的 provider 也遵守同样的约定）。
 */
export interface Model { id: string; stream(context: Context, options?: StreamOptions): Promise<AssistantMessage> }

export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

export function failedMessage(error: unknown, signal?: AbortSignal): AssistantMessage {
  const aborted = signal?.aborted === true;
  return {
    role: 'assistant',
    content: [],
    stopReason: aborted ? 'aborted' : 'error',
    errorMessage: aborted ? '请求已取消' : error instanceof Error ? error.message : String(error),
    usage: emptyUsage(),
  };
}
