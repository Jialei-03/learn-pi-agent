// 第 7 章“你来改”：mox 的会话是平的，想“回到过去”会怎样？
//   node labs/ch07/flat.ts
// 对话 U1 → A1 → U2 → A2，想回到 A1 重新问。先试最直接的办法（内存里把数组截短），再用 forkSession 分叉成新文件。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSession } from '../../mox/src/session.ts';
import { forkSession } from './fork.ts';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'ch07-flat-')));
const user = (content: string) => ({ role: 'user' as const, content });
const say = (content: string) => ({ role: 'assistant' as const, content });
const names = (ms: { content: any }[]) => ms.map(m => String(m.content).split(' ')[0]).join(' → ');
const add = (s: ReturnType<typeof openSession>, ...ms: ReturnType<typeof user>[]) => ms.forEach(m => { s.messages.push(m); s.save(m); });
const onDisk = (file: string) => readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l).message);

try {
  const naive = openSession('/repo', join(home, 'naive'));
  add(naive, user('U1 列出项目文件'), say('A1 有 README.md 和 src/'), user('U2 用 Python 重写'), say('A2 好的，开始改写……'));
  naive.messages.length = 2;                                           // 内存里回到 A1
  add(naive, user("U2' 给它加上类型"), say("A2' 好的，加上类型……"));
  console.log('只在内存里回退：');
  console.log(`  内存里：${names(naive.messages)}`);
  console.log(`  -c 恢复后：${names(openSession('/repo', join(home, 'naive'), true).messages)}`);
  assert.equal(names(openSession('/repo', join(home, 'naive'), true).messages), "U1 → A1 → U2 → A2 → U2' → A2'");

  const h2 = join(home, 'fork');
  const original = openSession('/repo', h2);
  add(original, user('U1 列出项目文件'), say('A1 有 README.md 和 src/'), user('U2 用 Python 重写'), say('A2 好的，开始改写……'));
  const fork = forkSession(original, 2, '/repo', h2);
  add(fork, user("U2' 给它加上类型"), say("A2' 好的，加上类型……"));
  const dir = join(h2, '.mox', 'sessions', readdirSync(join(h2, '.mox', 'sessions'))[0]);
  console.log('\nforkSession 把前 2 条复制进新文件：');
  console.log(`  ${readdirSync(dir).length} 个文件；原文件：${names(onDisk(original.file))}`);
  console.log(`  新文件：${names(onDisk(fork.file))}`);
  console.log(`  -c 恢复的是最新的文件：${names(openSession('/repo', h2, true).messages)}`);
  assert.equal(names(openSession('/repo', h2, true).messages), "U1 → A1 → U2' → A2'");
} finally {
  rmSync(home, { recursive: true, force: true });
}
