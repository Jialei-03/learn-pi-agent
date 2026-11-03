// 第 6 章实验：提示缓存能复用多少？
//   node labs/ch06/cache.ts
// 服务商的提示缓存按“前缀”命中：这次请求的开头和上次完全相同的部分，可以按更低的价格计费、更快地处理。
// 这里模拟一次 6 轮的运行，计算每次请求里“与上一次请求相同的前缀”占多少（按字节，简化了服务商的实际规则）。
import { anthropicRequestBody } from '../../mox/src/providers/anthropic.ts';
import { buildPromptSections, diffSections, renderPatch, renderSections } from '../../mox/src/context.ts';
import type { Message } from '../../mox/src/types.ts';

const tools = [{ name: 'read', description: '读取文件', parameters: { type: 'object', properties: { path: { type: 'string' } } } }];
const agents = (v: string) => [{ path: '/repo/AGENTS.md', content: v }];
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** 生成第 n 轮之后的历史：每轮一次读文件、一段结果。 */
function history(turns: number): Message[] {
  const out: Message[] = [{ role: 'user', content: '帮我理解这个项目的结构。' }];
  for (let i = 1; i <= turns; i++) {
    out.push({ role: 'assistant', stopReason: 'toolUse', usage, content: [{ type: 'toolCall', id: `c${i}`, name: 'read', arguments: { path: `src/file${i}.ts` } }] });
    out.push({ role: 'toolResult', toolCallId: `c${i}`, toolName: 'read', content: `// file${i}.ts\n` + 'export const x = 1;\n'.repeat(200), isError: false });
  }
  return out;
}

const commonPrefix = (a: string, b: string) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };

type Strategy = (turn: number) => { system: string; messages: Message[] };
const strategies: Record<string, Strategy> = {
  'A 系统提示里放了当前时间': turn => ({
    system: renderSections(buildPromptSections({ cwd: '/repo', tools, contextFiles: agents('用 pnpm。') })) + `\n当前时间：2026-11-03 10:00:${String(turn * 7).padStart(2, '0')}`,
    messages: history(turn),
  }),
  'B 系统提示稳定，历史只追加': turn => ({
    system: renderSections(buildPromptSections({ cwd: '/repo', tools, contextFiles: agents('用 pnpm。') })),
    messages: history(turn),
  }),
  'C 第 3 轮改了 AGENTS.md，重写开头': turn => ({
    system: renderSections(buildPromptSections({ cwd: '/repo', tools, contextFiles: agents(turn >= 3 ? '用 pnpm，提交前跑测试。' : '用 pnpm。') })),
    messages: history(turn),
  }),
  'D 第 3 轮改了 AGENTS.md，追加一条更新': turn => {
    const before = buildPromptSections({ cwd: '/repo', tools, contextFiles: agents('用 pnpm。') });
    const after = buildPromptSections({ cwd: '/repo', tools, contextFiles: agents('用 pnpm，提交前跑测试。') });
    const messages = history(turn);
    // 更新以一条新消息的形式插在第 3 轮的位置，之后一直留在历史里；开头的系统提示保持不变
    if (turn >= 3) messages.splice(1 + 2 * 2, 0, { role: 'user', content: renderPatch(diffSections(before, after)!) });
    return { system: renderSections(before), messages };
  },
};

console.log('| 策略 | 第 2 次 | 第 3 次 | 第 4 次 | 第 5 次 | 第 6 次 | 6 次合计 |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const [name, strategy] of Object.entries(strategies)) {
  let previous = '';
  let reused = 0;
  let total = 0;
  const cells: string[] = [];
  for (let turn = 1; turn <= 6; turn++) {
    const { system, messages } = strategy(turn);
    const body = JSON.stringify(anthropicRequestBody({ systemPrompt: system, messages, tools }, 'claude-sonnet-4-5'));
    const prefix = turn === 1 ? 0 : commonPrefix(previous, body);
    if (turn > 1) cells.push(`${Math.round((prefix / body.length) * 100)}%`);
    reused += prefix;
    total += body.length;
    previous = body;
  }
  console.log(`| ${name} | ${cells.join(' | ')} | ${Math.round((reused / total) * 100)}% |`);
}
