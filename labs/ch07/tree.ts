// 第 7 章实验：在会话里回到过去，开一个新分支。
//   node labs/ch07/tree.ts
// 对话：U1 → A1 → U2「用 Python 重写」→ A2。用户反悔，回到 A1，改问 U2'「给它加上类型」→ A2'。
// 两个分支都留在同一个文件里；“当前分支”由叶子决定。重新打开文件，叶子是最后写入的那条。
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { Session } from '../../mox/src/session.ts';
import type { Message } from '../../mox/src/types.ts';

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const user = (t: string): Message => ({ role: 'user', content: t });
const assistant = (t: string): Message => ({ role: 'assistant', content: [{ type: 'text', text: t }], stopReason: 'stop', usage });
const say = (m: any) => (m.role === 'user' ? (typeof m.content === 'string' ? m.content : m.content[0].text) : m.content[0].text);

// ── mox ──────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'ch07-'));
const s = Session.create('/repo', join(dir, 'mox'));
s.appendMessage(user('U1 列出项目文件'));
const a1 = s.appendMessage(assistant('A1 有 README.md 和 src/'));
s.appendMessage(user('U2 用 Python 重写'));
const a2 = s.appendMessage(assistant('A2 好的，开始改写成 Python……'));
s.branch(a1);                                                 // 回到 A1
s.appendMessage(user("U2' 给它加上类型"));
const a2b = s.appendMessage(assistant("A2' 好的，加上 TypeScript 类型……"));

console.log('━━ mox：文件里的记录（每行一条） ━━');
for (const line of readFileSync(s.file!, 'utf8').trim().split('\n')) {
  const e = JSON.parse(line);
  console.log(e.type === 'session' ? `  [header] id=${e.id}` : `  ${e.id}  parent=${String(e.parentId).padEnd(8)}  ${say(e.message)}`);
}
console.log(`\n  叶子在 A2 时，模型看到：${s.messages(a2).map(say).map(t => t.split(' ')[0]).join(' → ')}`);
console.log(`  叶子在 A2' 时，模型看到：${s.messages(a2b).map(say).map(t => t.split(' ')[0]).join(' → ')}`);
console.log(`  A1 的孩子：${s.children(a1).map(e => (e.type === 'message' ? say(e.message).split(' ')[0] : e.type)).join('、')}（这里是分叉点）`);
const reopened = Session.open(s.file!);
console.log(`  重新打开后的当前分支：${reopened.messages().map(say).map(t => t.split(' ')[0]).join(' → ')}`);

// ── Pi ───────────────────────────────────────────────
const pi = SessionManager.create('/repo', join(dir, 'pi'));
const piUser = (t: string) => ({ role: 'user' as const, content: t, timestamp: 0 });
pi.appendMessage(piUser('U1 列出项目文件'));
const p1 = pi.appendMessage(fauxAssistantMessage('A1 有 README.md 和 src/'));
pi.appendMessage(piUser('U2 用 Python 重写'));
pi.appendMessage(fauxAssistantMessage('A2 好的，开始改写成 Python……'));
pi.branch(p1);
pi.appendMessage(piUser("U2' 给它加上类型"));
pi.appendMessage(fauxAssistantMessage("A2' 好的，加上 TypeScript 类型……"));
const piFile = pi.getSessionFile()!;
const piReopened = SessionManager.open(piFile, join(dir, 'pi'));
const piBranch = piReopened.buildSessionContext().messages.filter((m: any) => m.role !== 'system');
console.log('\n━━ Pi ━━');
console.log(`  文件里共 ${readFileSync(piFile, 'utf8').trim().split('\n').length} 行（1 行 header + 6 条消息）`);
console.log(`  重新打开后的当前分支：${piBranch.map(say).map((t: string) => t.split(' ')[0]).join(' → ')}`);
