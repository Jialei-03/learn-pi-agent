// 第 11 章实验：Pi 怎样加载一组“不规矩”的 Skill 目录？
//   node labs/ch11/pi-skills.ts
// 目录里故意放了：重名、没有描述、名字不合规范、描述写成多行、自带示例里还有一个 SKILL.md、标了仅手动调用。
import assert from 'node:assert/strict';
import { relative } from 'node:path';
import { rmSync } from 'node:fs';
import { formatSkillsForPrompt, loadSkills } from '@earendil-works/pi-coding-agent';
import { createSkillFixture } from './fixture.ts';

const { root, dirs } = createSkillFixture();
try {
  const pi = loadSkills({ cwd: root, agentDir: `${root}/.agent`, skillPaths: dirs, includeDefaults: false });
  const rel = (p: string) => relative(root, p);
  console.log('━━ 加载结果 ━━');
  for (const s of pi.skills as any[]) console.log(`  ${s.name}${s.disableModelInvocation ? '（仅手动）' : ''}：${s.description.replace(/\s+/g, ' ').trim()}  [${rel(s.filePath)}]`);
  console.log('\n━━ 诊断（加载时给出的警告）━━');
  pi.diagnostics.forEach((d: any) => console.log(`  ${rel(d.path ?? d.filePath ?? '')}：${d.message}`));
  console.log('\n━━ 放进系统提示的目录 ━━');
  const prompt = formatSkillsForPrompt(pi.skills).trim().replaceAll(root, '<目录>');
  console.log(prompt);

  const names = (pi.skills as any[]).map(s => s.name);
  assert.equal(names.filter(n => n === 'release-notes').length, 1, '重名只保留先发现的');
  assert.ok(!names.includes('broken'), '没有描述的不加载');
  assert.ok(!names.includes('demo'), 'Skill 自带示例里的 SKILL.md 不是独立的 Skill');
  assert.ok(names.includes('Bad_Name'), '名字不合规范只警告');
  assert.ok(!prompt.includes('<name>db-migration</name>'), '仅手动调用的不进目录');
} finally {
  rmSync(root, { recursive: true, force: true });
}
