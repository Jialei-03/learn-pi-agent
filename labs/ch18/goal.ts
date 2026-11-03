// 第 18 章实验：目标循环。模型说“修好了”不算数，node test.js 通过才算。
//   node labs/ch18/goal.ts
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
  session.dispose();
}

const fix = fauxAssistantMessage(fauxToolCall('edit', { path: 'src/add.js', edits: [{ oldText: 'a - b', newText: 'a + b' }] }, { id: 'e1' }), { stopReason: 'toolUse' });
await scenario('模型先是只嘴上说修好了', [fauxAssistantMessage('已经修好了。'), fix, fauxAssistantMessage('这次真的修好了：减号改成了加号。')]);
await scenario('模型一直不改文件', [fauxAssistantMessage('已经修好了。'), fauxAssistantMessage('我确认已经修好了。'), fauxAssistantMessage('确实修好了。')]);
