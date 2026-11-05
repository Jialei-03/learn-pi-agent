// 第 7 章实验：会话文件的最后一行写了一半，会怎样？
//   node labs/ch07/torn.ts
// 先试着制造半行：让一个不停写会话的进程在随机时刻被 kill -9，重复 8 次。
// 再手工造一个半行：mox 和 Pi 打开它，各自的反应；然后在 mox 里接着聊，看新消息会不会丢。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { openSession } from '../../mox/src/session.ts';

const tmp = (name: string) => realpathSync(mkdtempSync(join(tmpdir(), name)));
const home = tmp('ch07-home-');
const cwd = tmp('ch07-proj-');
const spam = join(import.meta.dirname, 'spam.ts');

try {
  // ── 一：kill -9 会撕裂一行吗？ ──
  let torn = 0, totalLines = 0;
  for (let trial = 0; trial < 8; trial++) {
    const trialHome = join(home, `trial-${trial}`);
    const child = spawn(process.execPath, [spam, cwd, trialHome], { stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 150 + trial * 11));     // 子进程一刻不停地写 ~2KB 的记录，这段时间里写了成千上万条
    child.kill('SIGKILL');
    await new Promise(r => child.once('close', r));
    const dir = join(trialHome, '.mox', 'sessions', readdirSync(join(trialHome, '.mox', 'sessions'))[0]);
    const text = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8');
    const lines = text.split('\n').filter(Boolean);
    totalLines += lines.length;
    if (!text.endsWith('\n') || lines.some(l => { try { JSON.parse(l); return false; } catch { return true; } })) torn++;
  }
  assert.ok(totalLines > 8000, '每次都应该写下上千行');
  console.log(`kill -9 了 8 次写会话的进程，每次都写下了上千行，出现半行的次数：${torn}`);
  console.log('（一条记录是一次 appendFileSync，操作系统要么把这次写完，要么还没开始；进程被杀不会停在中间。半行来自断电、磁盘写满、网络盘这类情况。）\n');
  assert.equal(torn, 0);

  // ── 二：手工造半行 ──
  const s = openSession(cwd, home);
  s.save({ role: 'user', content: '跑一下测试' });
  s.save({ role: 'assistant', content: '好的。' });
  appendFileSync(s.file, '{"type":"message","message":{"role":"user","con');       // 断电时写到一半，行尾没有换行
  console.log(`手工在 mox 的会话文件末尾追加半行（共 ${readFileSync(s.file, 'utf8').trim().split('\n').length} 行，最后一行不是合法 JSON）`);
  const resumed = openSession(cwd, home, true);
  console.log(`  mox  openSession(resume)：读回 ${resumed.messages.length} 条消息（${resumed.messages.map(m => m.role).join(' → ')}），坏行被跳过`);
  assert.equal(resumed.messages.length, 2);

  const pi = SessionManager.create(cwd, join(home, 'pi'));
  pi.appendMessage({ role: 'user', content: '跑一下测试', timestamp: 0 });
  pi.appendMessage(fauxAssistantMessage('好的。'));
  appendFileSync(pi.getSessionFile()!, '{"type":"message","id":"deadbeef","parentId":');
  const reopened = SessionManager.open(pi.getSessionFile()!, join(home, 'pi'));
  const roles = reopened.buildSessionContext().messages.filter((m: any) => m.role !== 'system').map((m: any) => m.role);
  console.log(`  Pi   SessionManager.open：读回 ${roles.length} 条消息（${roles.join(' → ')}），坏行被跳过`);
  assert.deepEqual(roles, ['user', 'assistant']);

  // 恢复之后接着聊：openSession 发现文件没有以换行结尾，先补了一个换行，新消息不会和半行粘在一起
  resumed.save({ role: 'user', content: '再试一次' });
  const lines = readFileSync(s.file, 'utf8').split('\n').filter(Boolean);
  console.log(`\n恢复后接着聊，追加一条「再试一次」。文件的最后两行：\n  ${lines.at(-2)}\n  ${lines.at(-1)}`);
  const again = openSession(cwd, home, true);
  console.log(`再恢复一次：读回 ${again.messages.length} 条消息（${again.messages.map(m => m.role).join(' → ')}）—— 半行单独占一行被跳过，新消息完好`);
  assert.equal(again.messages.length, 3);
  assert.equal(again.messages.at(-1)!.content, '再试一次');
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
}
