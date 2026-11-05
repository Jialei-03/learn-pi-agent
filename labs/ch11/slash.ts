// 第 11 章实验：用户用 /名字 强制使用一个 Skill，模型收到的用户消息是什么？
//   node labs/ch11/slash.ts
// mox 是真正的命令行（`mox -p "/release-notes ..."`），Pi 是真实的会话（`/skill:release-notes ...`）。
// 两边都只看第一次请求里那条用户消息。
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/compat';
import { createPiSession, textOf } from '../shared/pi-session.ts';
import { runMox } from '../shared/mox-cli.ts';
import { createSkillFixture, installSkills } from './fixture.ts';

const { root, dirs } = createSkillFixture();
const home = realpathSync(mkdtempSync(join(tmpdir(), 'ch11-home-')));
const project = realpathSync(mkdtempSync(join(tmpdir(), 'ch11-proj-')));
installSkills(root, home, ['release-notes']);
const box = (text: string) => text.replaceAll(home, '~').replaceAll(root, '<目录>').split('\n').map(l => '  │ ' + l).join('\n');

try {
  const run = await runMox(['-p', '/release-notes 写 v1.2.0 的发布说明'], { cwd: project, home, script: () => ({ text: '好的。' }) });
  const moxMessage = String(run.requests[0].messages[1].content);
  console.log('━━ mox：输入 /release-notes 写 v1.2.0 的发布说明 ━━');
  console.log('模型收到的第一条用户消息：');
  console.log(box(moxMessage));

  const { session } = await createPiSession({ skillPaths: dirs, responses: [fauxAssistantMessage('好的。')] });
  await session.prompt('/skill:release-notes 写 v1.2.0 的发布说明');
  const piMessage = textOf(session.messages.find((m: any) => m.role === 'user'));
  session.dispose();
  console.log('\n━━ Pi：输入 /skill:release-notes 写 v1.2.0 的发布说明 ━━');
  console.log('模型收到的第一条用户消息：');
  console.log(box(piMessage));

  console.log('\n| | mox | Pi |');
  console.log('| --- | --- | --- |');
  console.log(`| 元信息（--- name … ---） | ${moxMessage.includes('name: release-notes') ? '带着' : '去掉了'} | ${piMessage.includes('name: release-notes') ? '带着' : '去掉了'} |`);
  console.log(`| 注明 SKILL.md 所在的目录 | ${moxMessage.includes(home) ? '有' : '没有'} | ${piMessage.includes('location=') ? '有（location 属性）' : '没有'} |`);
  console.log(`| 用标签把 Skill 和用户的话分开 | ${moxMessage.includes('<skill') ? '有' : '没有'} | ${piMessage.includes('<skill') ? '有（<skill> 标签）' : '没有'} |`);

  assert.ok(moxMessage.startsWith('---\nname: release-notes'));
  assert.ok(moxMessage.endsWith('\n\n写 v1.2.0 的发布说明'));
  assert.ok(!moxMessage.includes(home));
  assert.ok(piMessage.startsWith('<skill name="release-notes"'));
} finally {
  for (const dir of [home, project, root]) rmSync(dir, { recursive: true, force: true });
}
