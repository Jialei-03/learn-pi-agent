// 第 18 章实验：进程在工具执行期间被杀死，重启后怎么继续？
//   node labs/ch18/crash.ts
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCodingTools } from '../../mox/src/coding/index.ts';
import { runLoop } from '../../mox/src/loop.ts';
import { scripted } from '../../mox/src/providers/scripted.ts';
import { findInterrupted, INTERRUPTED, settleInterrupted } from '../../mox/src/resume.ts';
import { Session } from '../../mox/src/session.ts';
import { runTools } from '../../mox/src/tools.ts';

const root = mkdtempSync(join(tmpdir(), 'ch18-'));
const cwd = join(root, 'project');
cpSync(fileURLToPath(new URL('../fixtures/mox-project', import.meta.url)), cwd, { recursive: true });
const sessions = join(root, 'sessions');
const lines = (dir: string) => (existsSync(join(dir, 'deploy.log')) ? readFileSync(join(dir, 'deploy.log'), 'utf8').trim().split('\n').length : 0);

// ① 子进程跑 mox，部署命令一执行完就把它杀掉（sleep 30 还在跑）
const child = spawn(process.execPath, [fileURLToPath(new URL('./crash-child.ts', import.meta.url)), cwd, sessions], { stdio: ['ignore', 'pipe', 'inherit'] });
const file = await new Promise<string>(resolve => child.stdout.once('data', d => resolve(String(d).trim())));
while (!existsSync(join(cwd, 'deploy.log'))) await new Promise(r => setTimeout(r, 20));
child.kill('SIGKILL');
await new Promise(r => child.once('close', r));

const session = Session.open(file);
console.log('━━ 进程被杀之后 ━━');
console.log(`会话记录：${session.messages().map(m => (m.role === 'assistant' ? `assistant（${m.content.filter(b => b.type === 'toolCall').length} 个工具调用）` : m.role)).join(' → ')}`);
console.log(`deploy.log：${lines(cwd)} 行——部署命令其实已经执行了，但它的结果没来得及写进会话（同一批的结果要等所有工具执行完才一起写）`);

// ② 朴素的做法：把没有结果的调用全部重新执行一遍（在项目的副本上试）
const copy = join(root, 'naive');
cpSync(cwd, copy, { recursive: true });
const calls = findInterrupted(session.messages());
await runTools(calls.filter(c => c.id !== 'c3'), createCodingTools(copy), { emit: () => {} });
console.log(`\n━━ 朴素做法：全部重新执行 ━━\ndeploy.log：${lines(copy)} 行——同一次部署执行了两遍`);

// ③ mox 的做法：read 重放安全，直接重新执行；两个 bash 写“中断”结果，让模型自己查证
const tools = createCodingTools(cwd);
const settled = await settleInterrupted(calls, tools);
for (const r of settled) session.appendMessage(r);
console.log('\n━━ mox 的做法 ━━');
for (const r of settled) console.log(`${r.toolName}（${calls.find(c => c.id === r.toolCallId)?.id}）：${r.content === INTERRUPTED ? '中断，交给模型查证' : `重放安全，重新执行 → ${r.content.split('\n')[0].slice(0, 30)}…`}`);
const model = scripted(c => {
  const results = c.messages.filter(m => m.role === 'toolResult');
  if (!results.some(r => r.role === 'toolResult' && r.toolCallId === 'check')) return { toolCalls: [{ id: 'check', name: 'bash', arguments: { command: 'cat deploy.log 2>/dev/null || echo "（没有 deploy.log）"' } }] };
  return { text: 'deploy.log 里已经有“部署 v2”：部署命令在中断前已经执行，不再重复。sleep 只是在等待，跳过。' };
});
const { messages } = await runLoop(session.messages(), [], { model, systemPrompt: '', tools, onEvent: e => { if (e.type === 'message') session.appendMessage(e.message); } });
for (const m of messages) {
  if (m.role === 'assistant') for (const b of m.content) { if (b.type === 'toolCall') console.log(`模型 → ${b.name} ${JSON.stringify(b.arguments)}`); if (b.type === 'text') console.log(`模型：${b.text}`); }
  if (m.role === 'toolResult') console.log(`  ✓ ${m.content.trim()}`);
}
console.log(`deploy.log：${lines(cwd)} 行`);
void writeFileSync;
