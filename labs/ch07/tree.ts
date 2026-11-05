// 第 7 章实验：想“回到过去、换个方向”，Pi 和 mox 各自怎么做？
//   node labs/ch07/tree.ts
// 对话：U1 列文件 → A1 → U2「用 Python 重写」→ A2。用户反悔，想回到 A1，改问 U2'「给它加上类型」。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { openSession } from '../../mox/src/session.ts';
import { forkSession } from './fork.ts';

const tmp = (name: string) => realpathSync(mkdtempSync(join(tmpdir(), name)));
const home = tmp('ch07-home-');
const cwd = tmp('ch07-proj-');
const user = (content: string) => ({ role: 'user' as const, content });
const say = (content: string) => ({ role: 'assistant' as const, content });
const names = (ms: { content: any }[]) => ms.map(m => String(typeof m.content === 'string' ? m.content : m.content[0].text).split(' ')[0]).join(' → ');
const onDisk = (file: string) => readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l).message);
const fileCount = (dir: string) => readdirSync(dir).filter(f => f.endsWith('.jsonl')).length;

try {
  // ── Pi：一棵树 ──
  const piDir = join(home, 'pi');
  const pi = SessionManager.create(cwd, piDir);
  const piUser = (t: string) => ({ role: 'user' as const, content: t, timestamp: 0 });
  pi.appendMessage(piUser('U1 列出项目文件'));
  const a1 = pi.appendMessage(fauxAssistantMessage('A1 有 README.md 和 src/'));
  pi.appendMessage(piUser('U2 用 Python 重写'));
  pi.appendMessage(fauxAssistantMessage('A2 好的，开始改写成 Python……'));
  pi.branch(a1);                                                  // 回到 A1：只是移动叶子
  pi.appendMessage(piUser("U2' 给它加上类型"));
  pi.appendMessage(fauxAssistantMessage("A2' 好的，加上类型……"));
  const piFile = pi.getSessionFile()!;
  const piBranch = SessionManager.open(piFile, piDir).buildSessionContext().messages.filter((m: any) => m.role !== 'system');
  console.log('━━ Pi：移动叶子，开出新分支 ━━');
  console.log(`  文件 ${readFileSync(piFile, 'utf8').trim().split('\n').length} 行（1 行文件头 + 6 条消息），${fileCount(piDir)} 个文件`);
  console.log(`  重新打开后模型看到：${names(piBranch)}`);
  assert.equal(names(piBranch), "U1 → A1 → U2' → A2'");

  // ── mox：平铺，直接回退会怎样 ──
  const moxHome = join(home, 'mox-naive');
  const flat = openSession(cwd, moxHome);
  for (const m of [user('U1 列出项目文件'), say('A1 有 README.md 和 src/'), user('U2 用 Python 重写'), say('A2 好的，开始改写成 Python……')]) { flat.messages.push(m); flat.save(m); }
  flat.messages.length = 2;                                       // 内存里回到 A1
  for (const m of [user("U2' 给它加上类型"), say("A2' 好的，加上类型……")]) { flat.messages.push(m); flat.save(m); }
  console.log('\n━━ mox：只在内存里回退 ━━');
  console.log(`  内存里：${names(flat.messages)}`);
  const reopened = openSession(cwd, moxHome, true);
  console.log(`  -c 恢复后：${names(reopened.messages)}`);
  assert.equal(names(reopened.messages), "U1 → A1 → U2 → A2 → U2' → A2'");

  // ── mox：分叉成新文件 ──
  const home2 = join(home, 'mox-fork');
  const original = openSession(cwd, home2);
  for (const m of [user('U1 列出项目文件'), say('A1 有 README.md 和 src/'), user('U2 用 Python 重写'), say('A2 好的，开始改写成 Python……')]) { original.messages.push(m); original.save(m); }
  const fork = forkSession(original, 2, cwd, home2);
  for (const m of [user("U2' 给它加上类型"), say("A2' 好的，加上类型……")]) { fork.messages.push(m); fork.save(m); }
  const dir2 = join(home2, '.mox', 'sessions', readdirSync(join(home2, '.mox', 'sessions'))[0]);
  console.log('\n━━ mox：forkSession 把前 2 条复制进新文件 ━━');
  console.log(`  ${fileCount(dir2)} 个文件；原文件：${names(onDisk(original.file))}`);
  console.log(`  新文件：${names(onDisk(fork.file))}`);
  console.log(`  -c 恢复的是最新的文件：${names(openSession(cwd, home2, true).messages)}`);
  assert.equal(fileCount(dir2), 2);
  assert.equal(names(openSession(cwd, home2, true).messages), "U1 → A1 → U2' → A2'");
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
}
