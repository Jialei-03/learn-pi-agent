// 离线组装 mox：把 cli.ts 里和扩展有关的那几十行搬过来，模型换成脚本，终端换成脚本化的回答。
// 实验用它加载真正的扩展、跑真正的 runLoop 和真正的工具；和命令行唯一的区别是没有 readline。
//   - ask：answers 是一串预先写好的回答（选项的文字），也可以是一个按问题现场决定的函数；answers 为 undefined 表示“没有终端”，ask 返回 undefined
//   - 权限：和 cli.ts 一样，先问扩展（tool_call），再按内置规则确认（read、task 直接放行，其余三选一，--yolo 跳过）
import { loadExtensions, type Extension } from '../../mox/src/extensions.ts';
import { runLoop, type Tool } from '../../mox/src/loop.ts';
import type { Model, Msg } from '../../mox/src/model.ts';
import { codingTools } from '../../mox/src/tools.ts';

export type Answers = string[] | ((question: string, choices: string[]) => string) | undefined;
export interface Step { name: string; args: any; result: string; error: boolean }
export interface Question { question: string; choices: string[]; reply?: string }

export async function assemble({ cwd, model, sources = [], answers, yolo = false, system = '你是 mox，一个编程助手。' }: {
  cwd: string; model: Model; sources?: Array<string | Extension>; answers?: Answers; yolo?: boolean; system?: string;
}) {
  const tools: Tool[] = codingTools(cwd);
  const queue = Array.isArray(answers) ? [...answers] : answers;   // 数组：逐个取；函数：现场回答；undefined：没有终端
  const questions: Question[] = [];
  // 和 cli.ts 的 ask 一样：没有终端返回 undefined；回答不在选项里也是 undefined（输入了无效序号）
  const ask = async (question: string, choices: string[]) => {
    if (!queue) return undefined;
    const reply = typeof queue === 'function' ? queue(question, choices) : queue.shift();
    questions.push({ question, choices, reply });
    return reply !== undefined && choices.includes(reply) ? reply : undefined;
  };
  const extensions = await loadExtensions(sources, { cwd, tools, ask });
  const systemPrompt = () => [system, ...extensions.prompts.map(part => part())].filter(Boolean).join('\n\n');

  // 这几行就是 cli.ts 里的权限（mox/src/cli.ts#L64-L74）
  const allowed = new Set(['read', 'grep', 'find', 'ls', 'task']);
  async function beforeTool(name: string, args: unknown) {
    const verdict = await extensions.verdict(name, args);
    if (typeof verdict === 'string') return verdict;
    if (verdict === true || yolo || allowed.has(name)) return;
    if (!queue) return '没有终端可以确认，已拒绝。想自动执行请加 --yolo';
    const reply = await ask(`允许 ${name} ${JSON.stringify(args).slice(0, 80)}？`, ['允许', '本次会话都允许', '拒绝']);
    if (reply === '本次会话都允许') allowed.add(name);
    else if (reply !== '允许') return '用户拒绝了这次调用';
  }
  const afterTool = async (name: string, args: unknown, result: string) => extensions.text(await extensions.emit('tool_result', name, args, result));

  const messages: Msg[] = [];
  const steps: Step[] = [];
  async function run(text: string | undefined) {
    let final = '';
    while (text) {
      messages.push({ role: 'user', content: text });
      final = await runLoop(messages, {
        model, system: systemPrompt(), tools, beforeTool, afterTool,
        onEvent: e => { if (e.type === 'tool_end') steps.push({ name: e.call.function.name, args: JSON.parse(e.call.function.arguments || '{}'), result: e.result, error: e.error }); },
      });
      text = extensions.text(await extensions.emit('agent_end', final));   // 扩展可以让 Agent 接着干
    }
    return final;
  }
  /** 像在命令行里输入 /名字 参数 那样调用扩展注册的命令 */
  const command = async (line: string) => {
    const [name, ...rest] = line.slice(1).split(' ');
    const run = extensions.commands.get(name);
    if (!run) throw new Error(`没有命令 /${name}`);
    return run(rest.join(' '));
  };
  return { cwd, tools, messages, steps, questions, run, command, system: systemPrompt, shutdown: () => extensions.emit('shutdown') };
}

/** 一步的摘要：bash 显示命令，其他工具显示路径 */
export const describe = (s: Step) => (s.name === 'bash' ? s.args.command : `${s.name} ${s.args.path ?? JSON.stringify(s.args).slice(0, 60)}`);
/** 工具结果的第一行，用于表格 */
export const firstLine = (s: string, n = 70) => (s.split('\n').find(l => l.trim()) ?? '').slice(0, n);
