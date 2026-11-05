// 离线运行真正的 mox 命令行：本机起一个只会照剧本说话的“假模型”服务器（OpenAI 兼容的流式接口），
// 把 MOX_BASE_URL 指过去。mox 走的是和真实模型完全相同的网络代码，只是对面的回复由实验决定。
// 服务器记下每次收到的请求体，实验可以检查 mox 到底发出了什么（系统提示、消息、工具定义）。
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { ScriptReply } from './scripted.ts';

const CLI = fileURLToPath(new URL('../../mox/src/cli.ts', import.meta.url));

export type ChatRequest = { messages: any[]; tools?: { type: 'function'; function: { name: string; description: string; parameters: object } }[] };
/** n 是第几次请求（从 1 开始）。 */
export type CliScript = (request: ChatRequest, n: number) => ScriptReply;

export async function startFakeModel(script: CliScript) {
  const requests: ChatRequest[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      const request: ChatRequest = JSON.parse(body);
      requests.push(request);
      const reply = script(request, requests.length);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (delta: object, finish: string | null = null) => res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\n`);
      const text = reply.text ?? '';
      for (let i = 0; i < text.length; i += 8) send({ content: text.slice(i, i + 8) });
      (reply.toolCalls ?? []).forEach((c, i) => {
        const args = JSON.stringify(c.arguments);
        // 和真实服务一样：id 和名字在第一片，参数拆成两片
        send({ tool_calls: [{ index: i, id: c.id ?? `call_${requests.length}_${i + 1}`, type: 'function', function: { name: c.name, arguments: args.slice(0, 5) } }] });
        send({ tool_calls: [{ index: i, function: { arguments: args.slice(5) } }] });
      });
      send({}, reply.finish ?? (reply.toolCalls?.length ? 'tool_calls' : 'stop'));
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, requests, close: () => void server.close() };
}

export type MoxRun = {
  child: ChildProcess;
  output: () => string;
  /** 等到输出里出现某段文字。 */
  until: (pattern: RegExp, timeoutMs?: number) => Promise<void>;
  done: Promise<number | null>;
};

/** 在 cwd 里运行 mox 命令行；home 是隔离的家目录（~/.mox 在里面）。 */
export function spawnMox(args: string[], options: { cwd: string; home: string; url: string; env?: Record<string, string> }): MoxRun {
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd: options.cwd,
    detached: true,                       // 自成一个进程组，实验里 kill -9 时连它启动的命令一起收拾
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOME: options.home, MOX_BASE_URL: options.url, MOX_API_KEY: 'lab', MOX_MODEL: 'fake', NO_COLOR: '1', ...options.env },
  });
  let out = '';
  const waiters: (() => void)[] = [];
  const take = (chunk: Buffer) => { out += chunk; waiters.slice().forEach(w => w()); };
  child.stdout!.on('data', take);
  child.stderr!.on('data', take);
  const done = new Promise<number | null>(resolve => child.on('close', resolve));
  const until = (pattern: RegExp, timeoutMs = 20_000) => new Promise<void>((resolve, reject) => {
    const check = () => { if (pattern.test(out)) { waiters.splice(waiters.indexOf(check), 1); clearTimeout(timer); resolve(); } };
    const timer = setTimeout(() => reject(new Error(`等不到 ${pattern}，目前的输出：\n${out}`)), timeoutMs);
    waiters.push(check);
    check();
  });
  return { child, output: () => out.replace(/\x1b\[[0-9;]*m/g, ''), until, done };
}

/** 跑一次 `mox -p ...` 到结束。 */
export async function runMox(args: string[], options: { cwd: string; home: string; script: CliScript; env?: Record<string, string> }) {
  const model = await startFakeModel(options.script);
  try {
    const run = spawnMox(args, { ...options, url: model.url });
    const code = await run.done;
    return { code, output: run.output(), requests: model.requests };
  } finally {
    model.close();
  }
}

/** 杀掉整个进程组（mox 和它启动的命令）。 */
export function killGroup(run: MoxRun) {
  try { process.kill(-run.child.pid!, 'SIGKILL'); } catch {}
}
