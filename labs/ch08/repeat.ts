// 第 8 章实验：压缩两次会怎样？旧摘要是怎样进入第二次摘要请求的？
//   node labs/ch08/repeat.ts
// 第一次的摘要写得很详细（60 条已完成的事项，约 3000 字）。第二次压缩时，它是 messages[0]，
// 和别的消息一起被转写成文本。看看这份旧摘要还剩多少。
import assert from 'node:assert/strict';
import { compact } from '../../mox/src/compact.ts';
import type { Msg } from '../../mox/src/model.ts';
import { scripted } from '../shared/scripted.ts';

const items = Array.from({ length: 60 }, (_, i) => `- 第 ${String(i + 1).padStart(2, '0')} 项：已经把 src/module-${i + 1}.ts 迁移到新接口并通过测试`);
const longSummary = `## 已完成\n${items.join('\n')}`;

const messages: Msg[] = [];
for (let t = 1; t <= 6; t++) {
  messages.push({ role: 'user', content: `第 ${t} 步` });
  messages.push({ role: 'assistant', content: `第 ${t} 步完成。` + '。'.repeat(600) });
}

const first = scripted([{ text: longSummary }]);
await compact(messages, first, 700);
console.log(`第一次压缩之后：${messages.length} 条消息，messages[0] 是摘要，${(messages[0].content as string).length} 个字符`);

const second = scripted([{ text: '（第二份摘要）' }]);
await compact(messages, second, 300);
const prompt = (second.requests[0].messages[0] as { content: string }).content;
const old = prompt.split('<对话>')[1];
const seen = items.filter(item => old.includes(item));
console.log(`第二次摘要请求里，旧摘要的 ${items.length} 条事项还剩 ${seen.length} 条：第 01 项 ～ ${seen.at(-1)!.slice(2, 8)}`);
console.log(`其余 ${items.length - seen.length} 条，摘要模型根本没有看到。\n`);
console.log('转写文本里，旧摘要最后能看到的两行：');
console.log(old.split('\n').filter(l => l.startsWith('- 第')).slice(-2).map(l => '  │ ' + l).join('\n'));

assert.ok(seen.length < items.length && seen.length > 20);
assert.ok(!old.includes(items.at(-1)!));
