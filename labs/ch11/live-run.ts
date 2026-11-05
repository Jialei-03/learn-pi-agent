// 第 11 章：用真实模型跑 mox + Skill（需要 MOX_BASE_URL、MOX_API_KEY、MOX_MODEL；网站构建时不运行）。
//   eval "$(python3 /tmp/mox-keys.py minimax)"; export MOX_MODEL=MiniMax-M3.1-Flash
//   node labs/ch11/live-run.ts > labs/ch11/recorded/live-run.txt
// 临时目录里建一个有几次提交的 git 仓库，把 release-notes 装进隔离的 ~/.mox/skills，让 mox 写发布说明。
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { createSkillFixture, installSkills } from './fixture.ts';

const { root } = createSkillFixture();
const home = realpathSync(mkdtempSync(join(tmpdir(), 'ch11-live-home-')));
const project = realpathSync(mkdtempSync(join(tmpdir(), 'ch11-live-proj-')));
installSkills(root, home, ['release-notes']);
const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=lab', '-c', 'user.email=lab@example.com', ...args], { cwd: project, stdio: 'ignore' });
git('init', '-q');
for (const [file, message] of [['a.txt', '初始提交'], ['b.txt', 'feat: 新增 list 命令'], ['c.txt', 'fix: 修复 Ctrl+C 不退出'], ['d.txt', 'feat!: 会话文件改成 JSONL']]) {
  writeFileSync(join(project, file), message);
  git('add', '.');
  git('commit', '-q', '-m', message);
  if (file === 'a.txt') git('tag', 'v1.0.0');
}
const task = '帮我写 v1.1.0 的发布说明，上一个版本是 v1.0.0。';
console.log(`$ mox --yolo -p "${task}"\n`);
const cli = new URL('../../mox/src/cli.ts', import.meta.url).pathname;
const r = spawnSync(process.execPath, [cli, '--yolo', '-p', task], { cwd: project, encoding: 'utf8', env: { ...process.env, HOME: home } });
process.stdout.write((r.stderr + r.stdout).replace(/\x1b\[[0-9;]*m/g, '').replaceAll(home, '~').replaceAll(project, '<项目>').replaceAll(userInfo().username, 'user').replace(/(\/private)?\/var\/folders\/\S+/g, '<临时目录>'));
