// 第 18 章实验：目标循环。模型说“修好了”不算数，node test.js 通过才算。
//   node labs/ch18/goal.ts
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/compat';
import { createGoalExtension } from '../../extensions/goal/index.ts';
import { createPiSession, textOf } from '../shared/pi-session.ts';
import { idle } from './shared.ts';

function project() {
  const cwd = mkdtempSync(join(tmpdir(), 'ch18-goal-'));
  mkdirSync(join(cwd, 'src'));
  writeFileSync(join(cwd, 'package.json'), '{"type":"module"}');
  writeFileSync(join(cwd, 'src', 'add.js'), 'export const add = (a, b) => a - b;\n');
  writeFileSync(join(cwd, 'test.js'), "import { add } from './src/add.js';\nif (add(2, 3) !== 5) { console.error(`FAIL add(2, 3) = ${add(2, 3)}，期望 5`); process.exit(1); }\nconsole.log('PASS');\n");
  return cwd;
}

async function scenario(title: string, responses: any[]) {
  const cwd = project();
  const notices: string[] = [];
  const { session } = await createPiSession({ cwd, responses, ui: { notify: (m: string) => notices.push(m), setStatus: () => {} }, extensions: [createGoalExtension({ maxRounds: 4 })] });
  await session.prompt('/goal "node test.js" 修好 add 函数');
  await idle(session);
  console.log(`━━ ${title} ━━`);
  for (const m of session.messages as any[]) {
    if (m.role === 'user') console.log(`用户：${textOf(m).split('\n')[0]}`);
    if (m.role === 'custom') console.log(`↳ ${textOf(m).split('\n').filter(Boolean).slice(0, 4).join(' / ')}`);
    if (m.role === 'assistant') for (const b of m.content) { if (b.type === 'text' && b.text) console.log(`模型：${b.text}`); if (b.type === 'toolCall') console.log(`模型 → ${b.name}`); }
  }
  console.log(`结果：${notices.at(-1)}\n`);
  const assistants = (session.messages as any[]).filter(m => m.role === 'assistant');
  const result = {
    notice: notices.at(-1) ?? '',
    modelMessages: assistants.length,
    edits: assistants.flatMap(m => m.content).filter((b: any) => b.type === 'toolCall' && b.name === 'edit').length,
    feedback: (session.messages as any[]).filter(m => m.role === 'custom').map(textOf).join('\n'),
  };
  session.dispose();
  return result;
}

const fix = fauxAssistantMessage(fauxToolCall('edit', { path: 'src/add.js', edits: [{ oldText: 'a - b', newText: 'a + b' }] }, { id: 'e1' }), { stopReason: 'toolUse' });
const fixed = await scenario('模型先是只嘴上说修好了', [fauxAssistantMessage('已经修好了。'), fix, fauxAssistantMessage('这次真的修好了：减号改成了加号。')]);
const stuck = await scenario('模型一直不改文件', [fauxAssistantMessage('已经修好了。'), fauxAssistantMessage('我确认已经修好了。'), fauxAssistantMessage('确实修好了。')]);

// 正文的结论：第一个场景里检查失败的输出被交回模型，第二轮真的改了代码，检查通过；
// 第二个场景里模型一直不改文件，第二轮就被原地打转检测拦下（没有等到轮数上限）
assert.ok(fixed.feedback.includes('add(2, 3) = -1，期望 5'), '检查失败时，测试的输出要交回给模型');
assert.equal(fixed.edits, 1);
assert.ok(fixed.notice.includes('目标达成'));
assert.equal(stuck.edits, 0);
assert.equal(stuck.modelMessages, 2, '第二轮就被拦下：模型只回复了两次');
assert.ok(stuck.notice.includes('原地打转'));
