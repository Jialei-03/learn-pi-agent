// 第 11 章实验：同一组 Skill 目录，mox 和 Pi 分别加载出什么？
//   node labs/ch11/skills.ts
// 目录里故意放了几个“不规矩”的 Skill：重名、没有描述、名字不合规范、描述写成多行、自带示例里还有一个 SKILL.md。
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { formatSkillsForPrompt, loadSkills as piLoadSkills } from '@earendil-works/pi-coding-agent';
import { loadSkills } from '../../mox/src/context.ts';
import { createSkillFixture } from './fixture.ts';

const { root, dirs } = createSkillFixture();
try {
  const mox = loadSkills(dirs);
  const pi = piLoadSkills({ cwd: root, agentDir: `${root}/.agent`, skillPaths: dirs, includeDefaults: false });

  const moxOf = (name: string) => mox.filter(s => s.name === name);
  const piOf = (name: string) => pi.skills.filter((s: any) => s.name === name);
  const show = (list: { description: string }[], visible = (_: any) => true) =>
    list.length === 0 ? '不加载' : list.map(s => `${visible(s) ? '' : '（不进目录）'}“${s.description.replace(/\n/g, ' ').trim() || '空'}”`).join(' ＋ ');
  const visible = (s: any) => !s.disableModelInvocation;

  console.log('| 目录里的情形 | mox 的目录里有 | Pi 的目录里有 |');
  console.log('| --- | --- | --- |');
  console.log(`| \`release-notes\` 在两个目录里各有一份 | ${moxOf('release-notes').length} 条 | ${piOf('release-notes').length} 条（保留先发现的） |`);
  console.log(`| \`db-migration\`：标了 disable-model-invocation | ${show(moxOf('db-migration'))} | ${show(piOf("db-migration"), visible)} |`);
  console.log(`| \`broken\`：没有 description | ${show(moxOf('broken'))} | ${show(piOf('broken'))} |`);
  console.log(`| \`Bad_Name\`：名字不合规范 | ${show(moxOf('Bad_Name'))} | ${show(piOf('Bad_Name'))} |`);
  console.log(`| \`folded\`：description 用 YAML 的 \`>\` 写成多行 | ${show(moxOf('folded'))} | ${show(piOf('folded'))} |`);
  console.log(`| \`release-notes/examples/demo/SKILL.md\`：Skill 自带的示例 | ${moxOf('demo').length ? '被当成独立的 Skill' : '没有加载'} | ${piOf('demo').length ? '被当成独立的 Skill' : '没有加载'} |`);

  console.log('\nPi 的诊断（加载时给出的警告）：');
  pi.diagnostics.forEach((d: any) => console.log(`  ${(d.path ?? d.filePath ?? '').replace(root, '<目录>')}：${d.message}`));
  console.log('mox 没有诊断：loadSkills 只返回一个数组。');

  console.log('\n━━ Pi 放进系统提示的内容（节选） ━━');
  console.log(formatSkillsForPrompt(pi.skills).trim().replaceAll(root, '<目录>').split('\n').slice(0, 12).join('\n') + '\n  ……');

  assert.equal(moxOf('release-notes').length, 2);
  assert.equal(piOf('release-notes').length, 1);
  assert.equal(moxOf('broken').length, 1);
  assert.equal(moxOf('broken')[0].description, '');
  assert.equal(piOf('broken').length, 0);
  assert.equal(moxOf('folded')[0].description, '>');
  assert.equal(moxOf('demo').length, 0);
  assert.equal(piOf('demo').length, 0);
  assert.ok(moxOf('db-migration').length === 1);
} finally {
  rmSync(root, { recursive: true, force: true });
}
