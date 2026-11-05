// 第 6 章实验：提示缓存能复用多少？
//   node labs/ch06/cache.ts
// 服务商的提示缓存按“前缀”命中：这次请求的开头和上次完全相同的部分，可以按更低的价格计费、更快地处理。
// 这里用 mox 真实的 runLoop 跑 6 个用户回合（每回合：读一个文件，再回答），脚本模型记录每次请求，
// 把请求体序列化成和 openai() 发出的一样的 JSON，再计算“与上一次请求相同的前缀”占多少（按字符，简化了服务商的实际规则）。
//   A 扩展用 addSystemPrompt 加了一行当前时间（每次运行前重新取值）
//   B mox 的做法：系统提示在启动时算一次，历史只追加；第 3 回合 AGENTS.md 在磁盘上改了，但不会重读
//   C 第 3 回合改了 AGENTS.md，每回合重新生成系统提示
//   D 第 3 回合改了 AGENTS.md，系统提示不动，在历史末尾追加一条更新消息
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { systemPrompt } from '../../mox/src/context.ts';
import { loadExtensions, type Extension } from '../../mox/src/extensions.ts';
import { runLoop, type Tool } from '../../mox/src/loop.ts';
import type { Msg } from '../../mox/src/model.ts';
import { scripted } from '../shared/scripted.ts';

const read: Tool = {
  name: 'read', description: '读取文件', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  run: ({ path }) => `// ${path}\n` + 'export const x = 1;\n'.repeat(200),
};
const OLD = '用 pnpm。', NEW = '用 pnpm，提交前跑测试。';
const commonPrefix = (a: string, b: string) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };

type Strategy = { label: string; prepare: (cwd: string, home: string) => Promise<(turn: number) => { system: string; before?: string }> };
const strategies: Strategy[] = [
  {
    label: 'A 扩展加了一行当前时间',
    prepare: async (cwd, home) => {
      let now = '';
      const clock: Extension = mox => mox.addSystemPrompt(() => `当前时间：10:00:${now}`);
      const extensions = await loadExtensions([clock], { cwd, tools: [], ask: async () => undefined });
      const base = systemPrompt(cwd, home, []);
      return turn => { now = String(turn * 7).padStart(2, '0'); return { system: [base, ...extensions.prompts.map(p => p())].join('\n\n') }; };
    },
  },
  {
    label: 'B 启动时算一次，历史只追加（mox）',
    prepare: async (cwd, home) => { const base = systemPrompt(cwd, home, []); return () => ({ system: base }); },
  },
  {
    label: 'C 第 3 回合改了 AGENTS.md，重新生成系统提示',
    prepare: async (cwd, home) => () => ({ system: systemPrompt(cwd, home, []) }),
  },
  {
    label: 'D 第 3 回合改了 AGENTS.md，追加一条更新消息',
    prepare: async (cwd, home) => {
      const base = systemPrompt(cwd, home, []);
      return turn => ({ system: base, before: turn === 3 ? `（项目说明已更新：${NEW}）` : undefined });
    },
  },
];

console.log('| 策略 | 第 2 回合 | 第 3 回合 | 第 4 回合 | 第 5 回合 | 第 6 回合 | 全部请求合计 |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
const totals: Record<string, { turns: number[]; all: number }> = {};
for (const strategy of strategies) {
  const cwd = mkdtempSync(join(tmpdir(), 'ch06-cache-'));
  writeFileSync(join(cwd, 'AGENTS.md'), OLD);
  const next = await strategy.prepare(cwd, join(cwd, 'home'));
  const model = scripted((_messages, n) => (n % 2 === 1 ? { toolCalls: [{ name: 'read', arguments: { path: `src/file${(n + 1) / 2}.ts` } }] } : { text: '读完了。' }));
  const messages: Msg[] = [];
  const firstRequestOfTurn: number[] = [];
  for (let turn = 1; turn <= 6; turn++) {
    if (turn === 3) writeFileSync(join(cwd, 'AGENTS.md'), NEW);       // 用户在会话中途改了说明文件
    const { system, before } = next(turn);
    firstRequestOfTurn.push(model.requests.length);
    if (before) messages.push({ role: 'user', content: before });
    messages.push({ role: 'user', content: `第 ${turn} 个问题：看看 src/file${turn}.ts` });
    await runLoop(messages, { model, system, tools: [read] });
  }
  const bodies = model.requests.map(r => JSON.stringify({ model: 'm', messages: r.messages, tools: r.tools, stream: true }));
  const reuse = bodies.map((body, i) => (i === 0 ? 0 : commonPrefix(bodies[i - 1], body)));
  const turns = firstRequestOfTurn.slice(1).map(i => Math.round((reuse[i] / bodies[i].length) * 100));
  const all = Math.round((reuse.reduce((a, b) => a + b, 0) / bodies.reduce((a, b) => a + b.length, 0)) * 100);
  totals[strategy.label[0]] = { turns, all };
  console.log(`| ${strategy.label} | ${turns.map(t => `${t}%`).join(' | ')} | ${all}% |`);
}

assert.ok(totals.A.turns.every(t => t < 20));                       // 时间在开头附近：每回合几乎全部失效
assert.ok(totals.B.turns.every(t => t > 85));                       // 只追加：每回合都命中
assert.ok(totals.C.turns[1] < 20 && totals.C.turns[0] > 85);       // 第 3 回合重写开头：那一次几乎全部失效
assert.ok(totals.D.turns.every(t => t > 85));                       // 追加更新：不影响缓存
