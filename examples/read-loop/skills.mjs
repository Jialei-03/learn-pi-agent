import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { formatSkillsForPrompt, loadSkills } from '@earendil-works/pi-coding-agent';

const cwd = await mkdtemp(join(tmpdir(), 'pi-skill-choice-'));
try {
  const dirs = ['team', 'mine'].map(source => join(cwd, source, 'review'));
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
    const name = basename(dirname(dir));
    await writeFile(join(dir, 'SKILL.md'), [
      '---', 'name: review', `description: ${name} review guide`,
      `disable-model-invocation: ${name === 'mine'}`, '---', `read ${name} criteria`,
    ].join('\n'));
  }
  for (const paths of [dirs, [...dirs].reverse()]) {
    const { skills, diagnostics } = loadSkills({ cwd, agentDir: cwd,
      skillPaths: paths, includeDefaults: false });
    assert.equal(skills.length, 1);
    assert.equal(skills[0].baseDir, paths[0]);
    const { winnerPath, loserPath } = diagnostics.find(item => item.type === 'collision').collision;
    const source = path => basename(dirname(dirname(path)));
    const indexed = formatSkillsForPrompt(skills).includes('<name>review</name>');
    assert.equal(indexed, source(winnerPath) === 'team');
    console.log(`胜者 ${source(winnerPath)}，落选 ${source(loserPath)}，已登记 ${skills.length}，模型索引 ${indexed ? '含 review' : '为空'}`);
  }
} finally {
  await rm(cwd, { recursive: true, force: true });
}
