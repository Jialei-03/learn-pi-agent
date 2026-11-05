// 第 11 章实验：渐进式披露——Skill 的全文什么时候才进入上下文？
//   node labs/ch11/progressive.ts
// 一个真实的 Pi 会话，加载第 11 章的 Skills 目录。模型（脚本）看到目录后，按需读取 SKILL.md 和它引用的规范文件。
import { join } from 'node:path';
import { fauxAssistantMessage, fauxToolCall, getSystemMessageText } from '@earendil-works/pi-ai/compat';
import { createPiSession, textOf } from '../shared/pi-session.ts';
import { createSkillFixture } from './fixture.ts';

const { root, dirs } = createSkillFixture();
const skillFile = join(root, 'skills/release-notes/SKILL.md');
const styleFile = join(root, 'skills/release-notes/references/style.md');
let indexChars = 0, indexCount = 0;

const { session } = await createPiSession({
  skillPaths: dirs,
  responses: [
    (context: any) => {
      const system = context.messages.filter((m: any) => m.role === 'system').map(getSystemMessageText).join('\n');
      const index = system.match(/<available_skills>[\s\S]*?<\/available_skills>/)?.[0] ?? '';
      indexChars = index.length; indexCount = (index.match(/<skill>/g) ?? []).length;
      return fauxAssistantMessage(fauxToolCall('read', { path: skillFile }, { id: 'r1' }), { stopReason: 'toolUse' });
    },
    fauxAssistantMessage(fauxToolCall('read', { path: styleFile }, { id: 'r2' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage('## v1.2.0 — 2026-11-03\n\n### 新功能\n- 新增 mox list 命令……'),
  ],
});
await session.prompt('帮我写 v1.2.0 的发布说明');
const reads = session.messages.filter((m: any) => m.role === 'toolResult');
console.log('━━ 模型按需读取 ━━');
console.log(`第 1 次请求时，系统提示里的 Skills 目录：${indexChars} 个字符（${indexCount} 个 Skill 的名字、描述、位置）`);
reads.forEach((m: any, i: number) => console.log(`第 ${i + 2} 次请求前读取了：${i === 0 ? 'SKILL.md' : 'references/style.md'}（${textOf(m).length} 个字符）`));
console.log(`没被读取的 Skill 和文件，一个字符都没有进入上下文。`);
session.dispose();

// /skill:名字 强制使用：即使它标了 disable-model-invocation，用户也可以显式调用
const forced = await createPiSession({ skillPaths: dirs, responses: [fauxAssistantMessage('好的，开始检查迁移脚本。')] });
await forced.session.prompt('/skill:db-migration 检查 migrations/0042.sql');
const user = forced.session.messages.find((m: any) => m.role === 'user');
console.log('\n━━ /skill:db-migration 检查 migrations/0042.sql ━━');
console.log('模型收到的用户消息：');
console.log(textOf(user).replaceAll(root, '<目录>').split('\n').map((l: string) => '  │ ' + l).join('\n'));
forced.session.dispose();
