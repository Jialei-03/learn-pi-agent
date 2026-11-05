// 在 runLoop 之上实现的最小 RPC（第 19 章的参考实现，不是 mox 的一部分）：stdin 进命令，stdout 出响应和事件，一行一条 JSON。
// mox 没有 SDK 或 RPC 模式；它的“SDK”就是模块本身：import 进来，自己装配 openai、runLoop、codingTools、openSession。
// 这个文件就是这样一个宿主：约六十行，对照 Pi 的 src/modes/rpc/。
//   node labs/ch19/mox-rpc.ts        （模型走 MOX_BASE_URL、MOX_API_KEY、MOX_MODEL，和 mox 命令行一样）
import { homedir } from 'node:os';
import { loadMox } from '../shared/mox-dir.ts';       // 默认是参考实现 mox/；设置 MOX_DIR 就用你自己的那份
import type { Event } from '../../mox/src/loop.ts';
import type { Msg } from '../../mox/src/model.ts';

const { runLoop } = await loadMox('loop.ts');
const { systemPrompt } = await loadMox('context.ts');
const { openai } = await loadMox('model.ts');
const { openSession } = await loadMox('session.ts');
const { codingTools } = await loadMox('tools.ts');

/** 循环的内部事件 → 线上的事件：只发外部关心的，形状稳定，内部重构不应该改变协议 */
function toWire(e: Event): Record<string, unknown> | undefined {
  if (e.type === 'text') return { type: 'text_delta', delta: e.text };
  if (e.type === 'message') return { type: 'message_end', message: e.message };
  if (e.type === 'tool_start') return { type: 'tool_start', toolCallId: e.call.id, name: e.call.function.name, arguments: e.call.function.arguments };
  if (e.type === 'tool_end') return { type: 'tool_end', toolCallId: e.call.id, isError: e.error, content: e.result };
}

/** 把字节流切成行：只认字节里的 \n（readline 还会在 U+2028 处断行，而它可以合法地出现在 JSON 字符串里） */
async function* lines(input: AsyncIterable<Buffer>) {
  let buffer = Buffer.alloc(0);
  for await (const chunk of input) {
    buffer = Buffer.concat([buffer, chunk]);
    for (let i; (i = buffer.indexOf(0x0a)) >= 0; buffer = buffer.subarray(i + 1)) yield buffer.subarray(0, i).toString('utf8').replace(/\r$/, '');
  }
}

// stdout 只放协议：把 process.stdout.write 换成写 stderr，自己留一个真正的写函数。之后谁在哪里 console.log，都不会混进协议
const raw = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
const write = (record: object) => raw(`${JSON.stringify(record)}\n`);

const cwd = process.cwd(), home = homedir();
const model = openai({ baseUrl: process.env.MOX_BASE_URL, apiKey: process.env.MOX_API_KEY, model: process.env.MOX_MODEL });
const tools = codingTools(cwd);                                   // RPC 里没有人可以问：工具直接执行（要审批就得把 ask 转给客户端，练习题）
const session = openSession(cwd, home);
const system = systemPrompt(cwd, home, []);
let controller: AbortController | undefined;                      // 有它，就是“正在运行”
const steering: string[] = [];
let current: Promise<void> = Promise.resolve();

async function execute(text: string, signal: AbortSignal) {
  const message: Msg = { role: 'user', content: text };
  session.messages.push(message);
  session.save(message);
  write({ type: 'agent_start' });
  let reason = 'stop', error: string | undefined;
  try {
    await runLoop(session.messages, {
      model, system, tools, signal,
      steer: () => steering.splice(0),
      onEvent: e => { if (e.type === 'message') session.save(e.message); const wire = toWire(e); if (wire) write(wire); },
    });
  } catch (e) { reason = signal.aborted ? 'aborted' : 'error'; error = (e as Error).message; }
  controller = undefined;                                         // 先标记空闲，再通知：客户端收到 agent_settled 后立刻发的 prompt 才会开始新的运行
  write({ type: 'agent_end', reason, ...(error && reason === 'error' ? { error } : {}) });
  write({ type: 'agent_settled', aborted: reason === 'aborted' });
}

function handle(line: string) {
  let cmd: { id?: string; type?: string; message?: string };
  try { cmd = JSON.parse(line); } catch (e) { return write({ type: 'response', command: 'parse', success: false, error: `无法解析命令：${(e as Error).message}` }); }
  const respond = (success: boolean, extra: object = {}) => write({ ...(cmd.id ? { id: cmd.id } : {}), type: 'response', command: cmd.type, success, ...extra });
  switch (cmd.type) {
    case 'prompt':
      if (!cmd.message) return respond(false, { error: '缺少 message' });
      if (controller) { steering.push(cmd.message); return respond(true, { data: { disposition: 'queued' } }); }   // 正在运行：作为插话
      controller = new AbortController();                         // 收下的这一刻就置位，不能等到 await 之后
      respond(true, { data: { disposition: 'started' } });         // “收下了”，不是“做完了”：完成看 agent_settled
      current = execute(cmd.message, controller.signal);           // 不 await：读命令的循环不能被一次运行占住
      return;
    case 'abort': controller?.abort(); void current.then(() => respond(true)); return;   // 和 Pi 一样：等运行收尾、会话空闲了再回复，客户端收到响应就可以发下一条 prompt
    case 'get_state': return respond(true, { data: { running: !!controller, messages: session.messages.length } });
    case 'get_messages': return respond(true, { data: { messages: session.messages } });
    default: return respond(false, { error: `未知命令：${cmd.type}` });
  }
}

for await (const line of lines(process.stdin)) if (line.trim()) handle(line);
await current;                                                     // stdin 关闭 = 请求退出：等正在进行的运行结束
