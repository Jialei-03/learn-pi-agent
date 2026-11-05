// 第 7 章实验：进程在写会话的过程中崩溃了，Pi 重新打开会怎样？
//   node labs/ch07/crash.ts
// 情形一：最后一行只写了一半。
// 情形二：模型的工具调用已经存下，工具还没执行完进程就没了——历史里有调用、没有结果。
// 情形三：一条失败的回复夹在中间。
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { transformMessages } from '@earendil-works/pi-ai/api/transform-messages';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { getModel } from '@earendil-works/pi-ai/compat';

const roles = (ms: any[]) => ms.map(m => (m.role === 'toolResult' ? `toolResult(${m.isError ? '错误' : '成功'})` : m.role === 'assistant' && m.content.some((b: any) => b.type === 'toolCall') ? 'assistant(调用 bash)' : m.role)).join(' → ');
const dir = mkdtempSync(join(tmpdir(), 'ch07-crash-'));
const model = getModel('anthropic', 'claude-sonnet-4-5') as any;
const lines = (file: string) => readFileSync(file, 'utf8').trim().split('\n').length;

try {
  // ── 情形一：半行 ──
  const pi = SessionManager.create('/repo', dir);
  pi.appendMessage({ role: 'user', content: '跑一下测试', timestamp: 0 });
  pi.appendMessage(fauxAssistantMessage('好的。'));
  appendFileSync(pi.getSessionFile()!, '{"type":"message","id":"deadbeef","parentId":');      // 写到一半，进程被杀
  console.log('情形一：最后一行只写了一半');
  const reopened = SessionManager.open(pi.getSessionFile()!, dir);
  const got = reopened.buildSessionContext().messages.filter((m: any) => m.role !== 'system');
  console.log(`  重新打开：${roles(got)}（坏行被跳过）`);
  assert.deepEqual(got.map((m: any) => m.role), ['user', 'assistant']);

  // ── 情形二：有调用没结果 ──
  const history = [
    { role: 'user', content: '跑一下测试', timestamp: 0 },
    fauxAssistantMessage(fauxToolCall('bash', { command: 'npm test' }, { id: 't1' }), { stopReason: 'toolUse' }),
    { role: 'user', content: '刚才断了，继续', timestamp: 1 },       // 工具没返回，进程崩溃；恢复后用户接着说话
  ];
  const fixed = transformMessages(history as any, model);
  console.log('\n情形二：历史里有工具调用，没有结果');
  console.log(`  保存的历史：${roles(history)}`);
  console.log('  原样发给 Anthropic 会被拒绝：每个 tool_use 后面必须紧跟对应的 tool_result');
  console.log(`  发送前修复：${roles(fixed)}`);
  assert.equal(roles(fixed), 'user → assistant(调用 bash) → toolResult(错误) → user');

  // ── 情形三：失败的回复 ──
  const withError = [
    { role: 'user', content: '解释这个函数', timestamp: 0 },
    { ...fauxAssistantMessage('这个函数的作用是'), stopReason: 'error', errorMessage: '连接中断' },
    { role: 'user', content: '再说一次', timestamp: 1 },
  ];
  const cleaned = transformMessages(withError as any, model);
  console.log('\n情形三：中间有一条失败的回复');
  console.log(`  保存的历史：${roles(withError)}`);
  console.log(`  发送前：${roles(cleaned)}（半截回复不重放）`);
  assert.equal(roles(cleaned), 'user → user');

  // 修复只发生在发送的那一份上，磁盘文件不动
  const s2 = SessionManager.create('/repo', dir);
  s2.appendMessage(history[0] as any); s2.appendMessage(history[1] as any); s2.appendMessage(history[2] as any);
  const before = lines(s2.getSessionFile()!);
  transformMessages(s2.buildSessionContext().messages.filter((m: any) => m.role !== 'system') as any, model);
  console.log(`\n会话文件：修复前后都是 ${before} 行 —— 补丁只存在于这一次请求里`);
  assert.equal(lines(s2.getSessionFile()!), before);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
