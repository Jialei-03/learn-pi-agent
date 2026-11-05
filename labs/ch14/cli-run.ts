// 启动真正的 mox 命令行（mox/src/cli.ts），连到一个假的模型服务（labs/shared/mox-cli.ts）；MOX_DIR 指向自己的 mox 时，跑的就是自己的 cli.ts。命令行、扩展、工具都是真的，只有模型是脚本。
// HOME 指向临时目录，所以 ~/.mox 里的配置（权限规则、扩展）完全由实验提供。
// 有 answers 时借一个伪终端运行（mox 的 ask 只在 stdin 是终端时才提问），没有时用 -p 一次性运行。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Msg } from '../../mox/src/model.ts';
import type { ChatRequest } from '../shared/mox-cli.ts';
import type { Script } from '../shared/scripted.ts';
import { startFakeModel } from '../shared/mox-cli.ts';
import { MOX_DIR } from '../shared/mox-dir.ts';

export interface CliRun {
  script: Script;
  /** 一句话，或者依次输入的几句（命令和任务）；-p 模式只能是一句 */
  prompt: string | string[];
  flags?: string[];
  /** 伪终端里依次回答每个提问的序号；不给就是 -p 模式（没有终端） */
  answers?: string[];
  /** 项目目录里的文件 */
  project?: Record<string, string>;
  /** 家目录里的文件，比如 .mox/permissions.json */
  home?: Record<string, string>;
}

export async function runCli({ script, prompt, flags = [], answers, project = {}, home = {} }: CliRun) {
  const root = mkdtempSync(join(tmpdir(), 'ch14-cli-'));
  const dirs = { home: join(root, 'home'), project: join(root, 'project') };
  for (const [where, files] of [['home', home], ['project', project]] as const) {
    mkdirSync(dirs[where], { recursive: true });
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dirs[where], name)), { recursive: true });
      writeFileSync(join(dirs[where], name), text);
    }
  }
  const adapted = (request: ChatRequest, n: number) => script(request.messages, n);
  const model = await startFakeModel(adapted);
  const env = { ...process.env, HOME: dirs.home, MOX_MODEL: 'scripted', MOX_BASE_URL: model.url, MOX_API_KEY: 'x' };
  const argv = [process.execPath, join(MOX_DIR, 'src/cli.ts'), ...flags];
  // 有 answers 就借一个伪终端像用户那样回答（mox 的 ask 只在 stdin 是终端时才提问），否则用 -p 一次性运行。
  // 必须异步等待：假的模型服务在这个进程里，同步等待子进程会让它没法响应
  const [command, args] = answers
    ? ['python3', ['-I', join(process.cwd(), 'labs/ch14/pty-driver.py'), JSON.stringify({ argv, prompts: [prompt].flat(), answers })]]
    : [argv[0], [...argv.slice(1), '-p', String(prompt)]];
  await new Promise<void>(done => spawn(command, args, { cwd: dirs.project, env, stdio: 'ignore' }).on('close', () => done()));
  const requests = model.requests;
  model.close();
  return { project: dirs.project, exists: (name: string) => existsSync(join(dirs.project, name)), outcomes: outcomes(requests.at(-1)!.messages), requests };
}

/** 每个工具调用和它的结果：从最后一次请求发给模型的消息里读出来 */
export function outcomes(messages: Msg[]) {
  const results = new Map(messages.flatMap(m => (m.role === 'tool' ? [[m.tool_call_id, m.content] as const] : [])));
  return messages.flatMap(m => (m.role === 'assistant' ? m.tool_calls ?? [] : [])).map(c => {
    const args = JSON.parse(c.function.arguments);
    const result = results.get(c.id) ?? '（没有结果）';
    return { what: c.function.name === 'bash' ? `bash ${args.command}` : args.path ? `${c.function.name} ${args.path}` : c.function.name, result, ok: !result.startsWith('错误：') };
  });
}

/** 模型脚本：第 n 次请求发出第 n 个调用，用完就给出最终回答 */
export const callsInOrder = (calls: { name: string; arguments: object }[]): Script => (_messages, n) => (n <= calls.length ? { toolCalls: [calls[n - 1]] } : { text: '做完了。' });
