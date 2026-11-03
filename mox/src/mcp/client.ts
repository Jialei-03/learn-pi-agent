// 最小的 MCP 客户端（第 12 章）：JSON-RPC 请求与响应的配对、握手、工具列表与调用。
// 连接是双向的：服务器也会发请求（ping）和通知（进度、工具列表变化）给客户端。
// 对照 Pi：packages/mcp/src/client.ts
import type { JsonRpcMessage, StdioTransport } from './transport.ts';

export const PROTOCOL_VERSION = '2025-11-25';
/** 服务器不支持我们要求的版本时，会回复它自己支持的最新版本；这些旧版本也接受。 */
const SUPPORTED_VERSIONS = [PROTOCOL_VERSION, '2025-06-18', '2025-03-26', '2024-11-05'];

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean; title?: string };
}
export type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image' | 'audio'; data: string; mimeType: string }
  | { type: 'resource_link'; uri: string; name: string; description?: string }
  | { type: 'resource'; resource: { uri: string; text?: string; blob?: string; mimeType?: string } };
export interface CallToolResult { content: McpContent[]; structuredContent?: unknown; isError?: boolean }

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 提供了它，请求就会带上 progressToken；每收到一次进度，超时计时重新开始。 */
  onProgress?: (progress: { progress: number; total?: number; message?: string }) => void;
}

interface Pending {
  method: string;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeoutMs: number;
  timer?: ReturnType<typeof setTimeout>;
  onProgress?: RequestOptions['onProgress'];
  cleanup: () => void;
}

export class McpError extends Error {
  code: number;
  constructor(code: number, message: string) { super(message); this.code = code; }
}

export class McpClient {
  serverInfo?: { name: string; version: string };
  instructions?: string;
  capabilities: Record<string, any> = {};
  /** 传输层的错误（比如服务器往 stdout 打了一行日志）只报告，不断开连接。 */
  onError: (error: Error) => void = () => {};
  private transport: StdioTransport;
  private nextId = 1;
  private pending = new Map<string | number, Pending>();
  private listeners = new Map<string, ((params: any) => void)[]>();
  private defaultTimeoutMs: number;
  private closed = false;

  constructor(transport: StdioTransport, options: { timeoutMs?: number } = {}) {
    this.transport = transport;
    this.defaultTimeoutMs = options.timeoutMs ?? 30_000;
    transport.onMessage = message => this.handle(message);
    transport.onClose = () => this.fail(new Error('MCP 服务器断开了连接'));
    transport.onError = error => this.onError(error);
  }

  /** 握手：initialize 请求 → 检查协议版本 → notifications/initialized 通知。之后才能发其他请求。 */
  async connect() {
    await this.transport.start();
    const result = await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'mox', version: '0.1.0' },
    });
    if (!SUPPORTED_VERSIONS.includes(result.protocolVersion)) {
      await this.close();
      throw new Error(`服务器选择了不支持的协议版本 ${result.protocolVersion}`);
    }
    this.serverInfo = result.serverInfo;
    this.capabilities = result.capabilities ?? {};
    this.instructions = result.instructions;
    await this.transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }

  request(method: string, params?: Record<string, unknown>, options: RequestOptions = {}): Promise<any> {
    if (this.closed) return Promise.reject(new Error('MCP 连接已关闭'));
    if (options.signal?.aborted) return Promise.reject(new Error('已取消'));
    const id = this.nextId++;
    // 进度令牌放在 params._meta 里，服务器在进度通知中带回它，我们据此找到对应的请求
    const body = options.onProgress ? { ...params, _meta: { progressToken: id } } : params;
    return new Promise((resolve, reject) => {
      const onAbort = () => this.cancel(id, new Error('已取消'), '用户取消');
      const entry: Pending = {
        method, resolve, reject, onProgress: options.onProgress,
        timeoutMs: options.timeoutMs ?? this.defaultTimeoutMs,
        cleanup: () => { clearTimeout(entry.timer); options.signal?.removeEventListener('abort', onAbort); },
      };
      this.pending.set(id, entry);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      this.armTimeout(id, entry);
      this.transport.send({ jsonrpc: '2.0', id, method, ...(body ? { params: body } : {}) })
        .catch(error => this.cancel(id, error));
    });
  }

  /** 超时或取消：本地立刻失败，并通知服务器停下（规范不允许取消 initialize）。 */
  private cancel(id: string | number, error: Error, reason?: string) {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    entry.cleanup();
    entry.reject(error);
    if (reason && entry.method !== 'initialize') {
      this.transport.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason } }).catch(() => {});
    }
  }

  private armTimeout(id: string | number, entry: Pending) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this.cancel(id, new Error(`MCP 请求 ${entry.method} 超过 ${entry.timeoutMs}ms 没有响应`), '超时'), entry.timeoutMs);
  }

  private handle(message: JsonRpcMessage) {
    // ① 响应：有 id，没有 method。按 id 找到等待中的请求
    if (message.id !== undefined && message.method === undefined) {
      const entry = this.pending.get(message.id);
      if (!entry) return;                                        // 已经超时或取消的请求，迟到的响应直接丢弃
      this.pending.delete(message.id);
      entry.cleanup();
      if (message.error) entry.reject(new McpError(message.error.code, message.error.message));
      else entry.resolve(message.result);
      return;
    }
    // ② 服务器发来的请求：有 id，也有 method。必须回复，哪怕只是“不支持”
    if (message.id !== undefined) {
      const reply = message.method === 'ping'
        ? { jsonrpc: '2.0' as const, id: message.id, result: {} }
        : { jsonrpc: '2.0' as const, id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } };
      this.transport.send(reply).catch(() => {});
      return;
    }
    // ③ 通知：没有 id，不需要回复
    if (message.method === 'notifications/progress') {
      const id = message.params?.progressToken;
      const entry = this.pending.get(id);
      if (entry) { this.armTimeout(id, entry); entry.onProgress?.(message.params); }
    }
    for (const listener of this.listeners.get(message.method!) ?? []) listener(message.params);
  }

  onNotification(method: string, listener: (params: any) => void) {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]);
  }

  /** 工具列表可能分页：沿着 nextCursor 一直取完。重复的游标说明服务器有 bug，直接报错，免得死循环。 */
  async listTools(): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await this.request('tools/list', cursor ? { cursor } : undefined);
      tools.push(...(page.tools ?? []));
      cursor = page.nextCursor || undefined;                    // 有的服务器用 null 或 "" 表示结束
      if (cursor && seen.has(cursor)) throw new Error(`tools/list 返回了重复的游标 ${cursor}`);
      if (cursor) seen.add(cursor);
    } while (cursor);
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>, options: RequestOptions = {}): Promise<CallToolResult> {
    const result = await this.request('tools/call', { name, arguments: args }, options);
    return { ...result, content: result.content ?? [] };          // 只返回 structuredContent 的服务器会省略 content
  }

  /** 连接断开：所有等待中的请求立即失败，而不是各自等到超时。 */
  private fail(error: Error) {
    this.closed = true;
    for (const [id, entry] of this.pending) { this.pending.delete(id); entry.cleanup(); entry.reject(error); }
  }

  async close() {
    this.fail(new Error('MCP 连接已关闭'));
    await this.transport.close();
  }
}
