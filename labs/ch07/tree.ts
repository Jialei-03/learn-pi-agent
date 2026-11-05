// 第 7 章实验：在 Pi 的会话里回到过去，开一个新分支。
//   node labs/ch07/tree.ts
// 对话：U1 → A1 → U2「用 Python 重写」→ A2。用户反悔，回到 A1，改问 U2'「给它加上类型」→ A2'。
// 两个分支都留在同一个文件里；“当前分支”由叶子决定。重新打开文件，叶子是最后写入的那条。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';

const dir = mkdtempSync(join(tmpdir(), 'ch07-'));
const piUser = (t: string) => ({ role: 'user' as const, content: t, timestamp: 0 });
const say = (m: any) => (typeof m.content === 'string' ? m.content : m.content[0].text);
const first = (ms: any[]) => ms.map(m => say(m).split(' ')[0]).join(' → ');

try {
  const pi = SessionManager.create('/repo', dir);
  pi.appendMessage(piUser('U1 列出项目文件'));
  const a1 = pi.appendMessage(fauxAssistantMessage('A1 有 README.md 和 src/'));
  const u2 = pi.appendMessage(piUser('U2 用 Python 重写'));
  pi.appendMessage(fauxAssistantMessage('A2 好的，开始改写成 Python……'));
  const before = first(pi.buildSessionContext().messages.filter((m: any) => m.role !== 'system'));
  pi.branch(a1);                                                  // 回到 A1：只移动叶子，不删任何记录
  pi.appendMessage(piUser("U2' 给它加上类型"));
  pi.appendMessage(fauxAssistantMessage("A2' 好的，加上类型……"));
  const file = pi.getSessionFile()!;

  console.log('文件里的记录（id 缩写成前 4 位，每行一条）：');
  for (const line of readFileSync(file, 'utf8').trim().split('\n')) {
    const e = JSON.parse(line);
    console.log(e.type === 'session' ? '  [header] 会话信息' : `  ${e.id.slice(0, 4)}  parent=${e.parentId ? e.parentId.slice(0, 4) : 'null'}  ${say(e.message).slice(0, 20)}`);
  }
  console.log(`\n叶子在 A2 时，模型看到：${before}`);
  const reopened = SessionManager.open(file, dir);
  const now = first(reopened.buildSessionContext().messages.filter((m: any) => m.role !== 'system'));
  console.log(`叶子在 A2' 时（重新打开文件后），模型看到：${now}`);
  const children = reopened.getEntries().filter((e: any) => e.parentId === a1).map((e: any) => say(e.message).split(' ')[0]);
  console.log(`A1 的孩子：${children.join('、')}（这里是分叉点）`);

  assert.equal(before, 'U1 → A1 → U2 → A2');
  assert.equal(now, "U1 → A1 → U2' → A2'");
  assert.equal(children.length, 2);
  assert.ok(u2);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
