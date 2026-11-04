// 把 mox 嵌进别的程序（第 19 章）：JSON 事件流与 RPC 模式。
//   mox --mode json -p "任务"   一次运行，stdout 上每行一个 JSON 事件，跑完退出
//   mox --mode rpc              长期运行，stdin 每行一条命令，stdout 每行一条响应或事件
// stdout 只放协议记录，其他输出一律走 stderr。对照 Pi：docs/json.md、docs/rpc.md、src/modes/rpc/
import type { AgentEvent } from './loop.ts';
import type { Message } from './types.ts';

/** 循环的内部事件 → 线上的事件。只发外部关心的，并且形状稳定：内部重构不应该改变协议 */
export function toWireEvent(e: AgentEvent): Record<string, unknown> | undefined {
  switch (e.type) {
    case 'agent_start': return { type: 'agent_start' };
    case 'agent_end': return { type: 'agent_end', reason: e.reason };
    case 'turn_start': return { type: 'turn_start', turn: e.turn };
    case 'stream': return e.event.type === 'text_delta' ? { type: 'text_delta', delta: e.event.delta } : undefined;
    case 'tool_start': return { type: 'tool_start', toolCallId: e.toolCall.id, name: e.toolCall.name, arguments: e.toolCall.arguments };
    case 'tool_end': return { type: 'tool_end', toolCallId: e.result.toolCallId, isError: !!e.result.isError, content: e.result.content };
    case 'message': return { type: 'message_end', message: e.message };
    default: return undefined;
  }
}

export interface RpcHost {
  /** 开始一次运行；返回的 Promise 在运行（包括追加任务）全部结束时完成 */
  execute(prompt: string): Promise<void>;
  isRunning(): boolean;
  steer(text: string): void;
  abort(): void;
  messages(): Message[];
  state(): Record<string, unknown>;
}

type Command = { id?: string; type: string; message?: string };

/**
 * 读 stdin 上的命令。按字节里的 \n 切分，而不是用 readline：
 * readline 还会在 U+2028、U+2029 处断行，而这两个字符可以合法地出现在 JSON 字符串里（Pi 的文档专门提醒了这一点）。
 */
export function startRpc(host: RpcHost, write: (record: object) => void, input: NodeJS.ReadableStream = process.stdin): Promise<void> {
  let buffer = Buffer.alloc(0);
  let current: Promise<void> | undefined;
  // 从“收下 prompt”到“这次运行全部结束”。host.isRunning() 要等 execute 里面创建了 AbortController 才为真，
  // 中间隔着几个 await：背靠背到达的第二条 prompt 会误以为空闲，开出第二个并发的运行（实验 wire.ts 守着这一点）
  let busy = false;
  const respond = (cmd: Command, success: boolean, extra: object = {}) => write({ ...(cmd.id ? { id: cmd.id } : {}), type: 'response', command: cmd.type, success, ...extra });

  const handle = (cmd: Command) => {
    switch (cmd.type) {
      case 'prompt': {
        if (!cmd.message) return respond(cmd, false, { error: '缺少 message' });
        // 正在运行：作为插话排队（第 3 章）；空闲：开始新的运行
        if (busy || host.isRunning()) { host.steer(cmd.message); return respond(cmd, true, { data: { disposition: 'queued' } }); }
        busy = true;
        respond(cmd, true, { data: { disposition: 'started' } });     // “收下了”，不代表“做完了”：完成看 agent_settled 事件
        const settle = (record: object) => { busy = false; write(record); };   // 先标记空闲，再通知：客户端收到 agent_settled 后立刻发的下一条 prompt 才会开始新运行
        current = host.execute(cmd.message).then(() => settle({ type: 'agent_settled' }), error => settle({ type: 'error', error: String(error) }));
        return;
      }
      case 'abort': host.abort(); return respond(cmd, true);
      case 'get_state': return respond(cmd, true, { data: host.state() });
      case 'get_messages': return respond(cmd, true, { data: { messages: host.messages() } });
      default: return respond(cmd, false, { error: `未知命令：${cmd.type}` });
    }
  };

  return new Promise(resolve => {
    input.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      let newline: number;
      while ((newline = buffer.indexOf(0x0a)) >= 0) {
        const line = buffer.subarray(0, newline).toString('utf8').replace(/\r$/, '');
        buffer = buffer.subarray(newline + 1);
        if (!line.trim()) continue;
        let cmd: Command;
        try { cmd = JSON.parse(line); } catch (error) { write({ type: 'response', command: 'parse', success: false, error: `无法解析命令：${(error as Error).message}` }); continue; }
        handle(cmd);
      }
    });
    // 客户端关闭 stdin = 请求退出：等正在进行的运行结束
    input.on('end', () => { void (current ?? Promise.resolve()).then(() => resolve()); });
  });
}
