// 第 7 章实验：进程退出之后，会话还在。
//   node labs/ch07/continue.ts
// 运行 mox 命令行三次（离线脚本模型）：第一次告诉它一个代号然后退出；第二次用 --continue 问它代号是什么；第三次开新会话再问一次。
// 脚本模型自己不记任何东西，能答出来，只能是因为第二次请求里带上了从文件恢复的历史。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'mox-home-'));          // 隔离的 ~/.mox
const project = mkdtempSync(join(tmpdir(), 'mox-project-'));
const cli = join(import.meta.dirname, '../../mox/src/cli.ts');
const env = { ...process.env, HOME: home, MOX_API: 'scripted', MOX_SCRIPT: join(import.meta.dirname, 'remember-script.ts') };
const run = (...args: string[]) => execFileSync(process.execPath, [cli, ...args], { cwd: project, env, encoding: 'utf8' }).trim();

try {
  console.log(`第一次：mox -p "记住，代号是青鸟。"\n  → ${run('-p', '记住，代号是青鸟。')}`);
  const answer = run('--continue', '-p', '代号是什么？');
  console.log(`第二次：mox --continue -p "代号是什么？"\n  → ${answer}`);
  assert.match(answer, /青鸟/);
  const fresh = run('-p', '代号是什么？');
  console.log(`第三次（不加 --continue，新会话）：mox -p "代号是什么？"\n  → ${fresh}`);
  assert.doesNotMatch(fresh, /青鸟/);

  // 找到 --continue 续写的那个会话文件
  const files: string[] = [];
  const walk = (dir: string) => { for (const name of readdirSync(dir)) { const p = join(dir, name); statSync(p).isDirectory() ? walk(p) : p.endsWith('.jsonl') && files.push(p); } };
  walk(join(home, '.mox'));
  const lines = files.map(f => readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l)));
  const continued = lines.find(l => l.some(e => e.message?.content?.includes?.('记住')))!;
  console.log(`\n会话目录里共 ${files.length} 个文件。被续写的那个有 ${continued.length} 行：`);
  for (const e of continued) console.log(`  ${e.type === 'session' ? '[header]' : `${e.message.role.padEnd(9)} ${JSON.stringify(typeof e.message.content === 'string' ? e.message.content : e.message.content.map((b: any) => b.text ?? '').join(''))}`}`);
  assert.equal(continued.length, 5);
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
}
