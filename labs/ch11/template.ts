// 第 11 章“你来改”的参考答案：mox 没有提示模板，这里给它补一个。不动 mox，只是一组纯函数。
// 一个 Markdown 文件就是一个 /命令；参数替换借鉴 shell：$1、$@、${1:-默认值}、${@:2}。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type PromptTemplate = { name: string; content: string };

/** prompts 目录里每个 .md 文件是一个模板，文件名就是命令名；开头的 --- 元信息忽略。 */
export function loadTemplates(dir: string): PromptTemplate[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.md')).sort().map(f => ({
    name: f.slice(0, -3),
    content: readFileSync(join(dir, f), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '').trim(),
  }));
}

/** 按 shell 的习惯切分参数，支持引号：并发 "锁 与 队列" → ['并发', '锁 与 队列']。 */
export const parseArgs = (text: string) => [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(m => m[1] ?? m[2] ?? m[3]);

/**
 * 一次扫描完成全部替换：$1 第 n 个参数；$@ 全部参数；${1:-默认值} 没给就用默认值；${@:2} 从第 2 个起的全部参数。
 * 只扫一遍，替换进去的内容不会被再次扫描——参数里即使写着 "$1" 也只是普通文字。
 */
export function substituteArgs(content: string, args: string[]) {
  const all = args.join(' ');
  return content.replace(/\$\{(\d+|@):-([^}]*)\}|\$\{@:(\d+)\}|\$(@|\d+)/g, (_, target, fallback, from, simple) => {
    if (target) return (target === '@' ? all : args[Number(target) - 1]) || fallback;
    if (from) return args.slice(Number(from) - 1).join(' ');
    return simple === '@' ? all : args[Number(simple) - 1] ?? '';
  });
}

/** 输入是 /名字 参数……且名字是某个模板，就展开；否则原样返回。 */
export function expandTemplate(input: string, templates: PromptTemplate[]) {
  const m = input.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  const template = m && templates.find(t => t.name === m[1]);
  return template ? substituteArgs(template.content, parseArgs(m![2] ?? '')) : input;
}
