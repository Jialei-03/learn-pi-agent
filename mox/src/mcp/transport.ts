// MCP 的 stdio 传输（第 12 章）：启动服务器进程，stdin 写、stdout 读，每行一条 JSON-RPC 消息。
// 对照 Pi：packages/mcp/src/transports/stdio.ts
import { type ChildProcess, spawn } from 'node:child_process';

export type JsonRpcMessage = { jsonrpc: '2.0'; id?: string | number; method?: string; params?: any; result?: any; error?: { code: number; message: string; data?: unknown } };

export interface StdioOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** 每条消息经过时调用：→ 发给服务器，← 从服务器收到。实验用它打印协议流量。 */
  onWire?: (direction: '→' | '←', message: JsonRpcMessage) => void;
}

const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

// 服务器放在独立的进程组里；宿主退出时如果没来得及正常关闭，统一杀掉整个组
const liveGroups = new Set<number>();
process.once('exit', () => { for (const pid of liveGroups) try { process.kill(-pid, 'SIGTERM'); } catch {} });

function killGroup(child: ChildProcess, signal: NodeJS.Signals) {
  // 负数 pid = 整个进程组。用 npx、uvx 启动的服务器，真正干活的是孙进程，只杀直接子进程会留下它们
  try { process.kill(-child.pid!, signal); } catch { try { child.kill(signal); } catch {} }
}

export class StdioTransport {
  onMessage: (message: JsonRpcMessage) => void = () => {};
  onError: (error: Error) => void = () => {};
  onClose: () => void = () => {};
  private options: StdioOptions;
  private child?: ChildProcess;
  private stdout = Buffer.alloc(0);
  private stderrTail = Buffer.alloc(0);
  private closed = false;

  constructor(options: StdioOptions) { this.options = options; }

  /** 服务器 stderr 的最后 64KB：连接失败时，这里通常就是原因。 */
  get stderr() { return this.stderrTail.toString('utf8'); }

  async start() {
    const child = spawn(this.options.command, this.options.args ?? [], {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,                                   // 自己一个进程组
    });
    this.child = child;
    child.stdout!.on('data', (chunk: Buffer) => this.readStdout(chunk));
    child.stderr!.on('data', (chunk: Buffer) => {
      this.stderrTail = Buffer.concat([this.stderrTail, chunk]);
      if (this.stderrTail.length > MAX_STDERR_BYTES) this.stderrTail = this.stderrTail.subarray(-MAX_STDERR_BYTES);
    });
    child.stdin!.on('error', error => { if (!this.closed) this.onError(error); });
    child.on('close', () => { liveGroups.delete(child.pid!); this.child = undefined; this.onClose(); });
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    liveGroups.add(child.pid!);
  }

  /**
   * 按字节找换行符，而不是先转成字符串：一个汉字的 UTF-8 编码可能被拆在两个数据块里（第 2 章的 SSE 也是同样的问题）。
   * 解析失败的行只报告错误，不断开连接——一行坏数据不该毁掉整个会话。
   */
  private readStdout(chunk: Buffer) {
    this.stdout = Buffer.concat([this.stdout, chunk]);
    let newline: number;
    while ((newline = this.stdout.indexOf(0x0a)) >= 0) {
      const line = this.stdout.subarray(0, newline).toString('utf8').replace(/\r$/, '');
      this.stdout = this.stdout.subarray(newline + 1);
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line) as JsonRpcMessage;
        if (message?.jsonrpc !== '2.0') throw new Error('不是 JSON-RPC 2.0 消息');
        this.options.onWire?.('←', message);
        this.onMessage(message);
      } catch (error) {
        this.onError(new Error(`无法解析服务器输出：${line.slice(0, 80)}（${(error as Error).message}）`));
      }
    }
    if (this.stdout.length > MAX_MESSAGE_BYTES) { this.stdout = Buffer.alloc(0); this.onError(new Error('单条消息超过 16MB')); }
  }

  async send(message: JsonRpcMessage) {
    const stdin = this.child?.stdin;
    if (this.closed || !stdin?.writable) throw new Error('MCP 连接已关闭');
    this.options.onWire?.('→', message);
    await new Promise<void>((resolve, reject) => stdin.write(JSON.stringify(message) + '\n', e => (e ? reject(e) : resolve())));
  }

  /** 规范建议的关闭顺序：先关 stdin 让服务器自己退出；500ms 后 SIGTERM；再过 2 秒 SIGKILL。 */
  async close() {
    if (this.closed) return;
    this.closed = true;
    const child = this.child;
    if (!child) return;
    await new Promise<void>(resolve => {
      const timers = [setTimeout(() => killGroup(child, 'SIGTERM'), 500), setTimeout(() => killGroup(child, 'SIGKILL'), 2500)];
      child.once('close', () => {
        timers.forEach(clearTimeout);
        killGroup(child, 'SIGTERM');                    // 服务器退出了，它启动的子进程未必退出
        resolve();
      });
      child.stdin!.end();
    });
  }
}
