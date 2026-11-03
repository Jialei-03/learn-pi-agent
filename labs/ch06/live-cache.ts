// 第 6 章：用真实模型观察提示缓存（需要 MOX_API_KEY，不在网站构建时运行）。
//   node labs/ch06/live-cache.ts
// 连续发 4 次请求，每次在历史末尾追加一问一答，看服务商报告的“命中缓存的输入 token”。
import { modelFromEnv } from '../../mox/src/cli.ts';
import { buildPromptSections, renderSections } from '../../mox/src/context.ts';
import type { Message } from '../../mox/src/types.ts';

const model = modelFromEnv();
const system = renderSections(buildPromptSections({ cwd: '/repo', tools: [], contextFiles: [{ path: '/repo/AGENTS.md', content: '这是一个笔记工具。\n'.repeat(120) }] }));
const messages: Message[] = [];
console.log(`模型：${model.id}\n`);
console.log('| 第几次请求 | 未命中缓存的输入 | 命中缓存的输入 | 命中比例 |');
console.log('| --- | --- | --- | --- |');
for (let i = 1; i <= 4; i++) {
  messages.push({ role: 'user', content: `第 ${i} 个问题：用一句话回答，${i} + ${i} 等于几？` });
  const reply = await model.stream({ systemPrompt: system, messages, tools: [] });
  messages.push(reply);
  const { input, cacheRead } = reply.usage;
  console.log(`| ${i} | ${input} | ${cacheRead} | ${Math.round((cacheRead / Math.max(1, input + cacheRead)) * 100)}% |`);
}
