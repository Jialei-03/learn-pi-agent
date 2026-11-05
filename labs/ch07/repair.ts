// 第 7 章实验：历史里有工具调用、没有结果。mox 和 Pi 各在什么时候、怎样修？
//   node labs/ch07/repair.ts
// 同一段历史：用户让跑测试 → 模型调用 bash → （进程在这里没了）→ 用户回来说“继续”。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { transformMessages } from '@earendil-works/pi-ai/api/transform-messages';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { getModel } from '@earendil-works/pi-ai/compat';
import { openSession } from '../../mox/src/session.ts';

const tmp = (name: string) => realpathSync(mkdtempSync(join(tmpdir(), name)));
const home = tmp('ch07-home-');
const cwd = tmp('ch07-proj-');
const lines = (file: string) => readFileSync(file, 'utf8').trim().split('\n').length;
const roles = (ms: any[]) => ms.map(m => (m.role === 'toolResult' ? `toolResult(${m.isError ? '错误' : '成功'})` : m.role === 'tool' ? 'tool' : m.role === 'assistant' && (m.tool_calls || m.content?.some?.((b: any) => b.type === 'toolCall')) ? 'assistant(调用 bash)' : m.role)).join(' → ');

try {
  // ── mox ──
  const s = openSession(cwd, home);
  const call = { id: 't1', type: 'function' as const, function: { name: 'bash', arguments: '{"command":"npm test"}' } };
  for (const m of [{ role: 'user' as const, content: '跑一下测试' }, { role: 'assistant' as const, content: null, tool_calls: [call] }]) s.save(m);
  console.log(`磁盘上的会话（进程没了）：${lines(s.file)} 行`);
  const resumed = openSession(cwd, home, true);
  console.log('\nmox  打开会话时修复（openSession）');
  console.log(`  内存里的历史：${roles(resumed.messages)}`);
  console.log(`  文件：${lines(s.file)} 行 —— 补上的“中断”结果也写进了文件`);
  assert.equal(lines(s.file), 3);

  // ── Pi ──
  const pi = SessionManager.create(cwd, join(home, 'pi'));
  pi.appendMessage({ role: 'user', content: '跑一下测试', timestamp: 0 });
  pi.appendMessage(fauxAssistantMessage(fauxToolCall('bash', { command: 'npm test' }, { id: 't1' }), { stopReason: 'toolUse' }));
  pi.appendMessage({ role: 'user', content: '刚才断了，继续', timestamp: 1 });
  const before = lines(pi.getSessionFile()!);
  const sent = transformMessages(pi.buildSessionContext().messages.filter((m: any) => m.role !== 'system') as any, getModel('anthropic', 'claude-sonnet-4-5') as any);
  console.log('\nPi   发送给模型之前修复（transformMessages）');
  console.log(`  保存的历史：user → assistant(调用 bash) → user`);
  console.log(`  发出去的：${roles(sent)}`);
  console.log(`  文件：${lines(pi.getSessionFile()!)} 行，修复前后都是 ${before} 行 —— 补丁只存在于这一次请求里`);
  assert.equal(lines(pi.getSessionFile()!), before);
  assert.equal(roles(sent), 'user → assistant(调用 bash) → toolResult(错误) → user');
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
}
