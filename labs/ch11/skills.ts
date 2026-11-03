// 第 11 章实验：同一组 Skill 目录，mox 和 Pi 分别加载出什么？系统提示里放了什么？
//   node labs/ch11/skills.ts
import { relative } from 'node:path';
import { formatSkillsForPrompt, loadSkills as piLoadSkills } from '@earendil-works/pi-coding-agent';
import { formatSkillsIndex, loadSkills } from '../../mox/src/skills.ts';
import { createSkillFixture } from './fixture.ts';

const { root, dirs } = createSkillFixture();
const rel = (p: string) => relative(root, p);
const mox = loadSkills(dirs);
const pi = piLoadSkills({ cwd: root, agentDir: `${root}/.agent`, skillPaths: dirs, includeDefaults: false });

console.log('━━ 加载结果 ━━');
console.log(`mox：${mox.skills.map(s => s.name + (s.disableModelInvocation ? '（仅手动）' : '')).join('、')}`);
console.log(`Pi ：${pi.skills.map((s: any) => s.name + (s.disableModelInvocation ? '（仅手动）' : '')).join('、')}`);
const nested = (r: { skills: { name: string }[] }) => r.skills.some(s => s.name === 'demo') ? '被加载了' : '没有加载';
console.log(`release-notes/examples/demo/SKILL.md：mox ${nested(mox)}，Pi ${nested(pi)}`);
console.log('\nmox 的诊断：');
mox.diagnostics.forEach(d => console.log(`  ${rel(d.file)}：${d.message}`));
console.log('Pi 的诊断：');
pi.diagnostics.forEach((d: any) => console.log(`  ${rel(d.path ?? d.filePath ?? '')}：${d.message}`));

console.log('\n━━ Pi 放进系统提示的内容 ━━');
console.log(formatSkillsForPrompt(pi.skills).trim().replaceAll(root, '<目录>'));
console.log('\n━━ mox 放进系统提示的内容 ━━');
console.log(formatSkillsIndex(mox.skills).replaceAll(root, '<目录>'));
