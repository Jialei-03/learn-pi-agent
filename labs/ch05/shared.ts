// 第 5 章实验的公共部分：准备一个有 bug 的小项目，用 mox 真实的 runLoop 和四个工具跑一遍，打印成和命令行一样的样子。
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLoop, type Event } from '../../mox/src/loop.ts';
import type { Model } from '../../mox/src/model.ts';
import { codingTools } from '../../mox/src/tools.ts';

/** 把有 bug 的示例项目复制到临时目录。 */
export function freshProject() {
  const dir = mkdtempSync(join(tmpdir(), 'ch05-calc-'));
  cpSync(new URL('../fixtures/calc-bug', import.meta.url), dir, { recursive: true });
  return dir;
}

const oneLine = (s: string, n = 96) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

/** 和 mox/src/cli.ts 里 show() 一样的打印：● 工具名 参数，✓ / ✗ 结果。 */
export function transcript(lines: string[], dir: string) {
  // 打印前抹掉每台机器、每次运行都不同的部分：临时目录、用户名、时间、很大的数字（ls -la 里的目录计数）
  const clean = (s: string) => s.replaceAll(dir, '<项目目录>').replaceAll(process.env.USER ?? '\0', 'user')
    .replace(/[A-Z][a-z]{2} +\d+ +\d\d:\d\d/g, '<时间>').replace(/\b\d{4,}\b/g, '…');
  return (e: Event) => {
    if (e.type === 'tool_start') lines.push(`● ${e.call.function.name} ${oneLine(clean(e.call.function.arguments))}`);
    if (e.type === 'tool_end') lines.push(`  ${e.error ? '✗' : '✓'} ${oneLine(clean(e.result))}`);
  };
}

/** 用给定的模型在项目里跑一次任务（相当于 `mox -p 任务 --yolo`），返回打印出来的记录和最终回答。 */
export async function runTask(model: Model, dir: string, prompt: string) {
  const lines: string[] = [];
  const answer = await runLoop([{ role: 'user', content: prompt }], {
    model, system: '你是 mox，一个在终端里工作的编程助手。', tools: codingTools(dir), onEvent: transcript(lines, dir),
  });
  return { lines, answer };
}

export const file = (dir: string, name: string) => readFileSync(join(dir, name), 'utf8');
