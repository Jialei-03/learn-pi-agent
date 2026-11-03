// 第 7 章实验：进程在写会话的过程中崩溃了，重新打开会怎样？
//   node labs/ch07/crash.ts
// 情形一：最后一行只写了一半。
// 情形二：模型的工具调用已经存下，工具还没执行完进程就没了——历史里有调用、没有结果。
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { transformMessages } from '@earendil-works/pi-ai/api/transform-messages';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { getModel } from '@earendil-works/pi-ai/compat';
import { Session } from '../../mox/src/session.ts';
import { repairTranscript } from '../../mox/src/transcript.ts';
import type { Message } from '../../mox/src/types.ts';

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const roles = (ms: any[]) => ms.map(m => (m.role === 'toolResult' ? `toolResult(${m.isError ? '错误' : '成功'})` : m.role === 'assistant' && m.content.some((b: any) => b.type === 'toolCall') ? 'assistant(调用 bash)' : m.role)).join(' → ');
const dir = mkdtempSync(join(tmpdir(), 'ch07-crash-'));

// ── 情形一：半行 ─────────────────────────────────────
const s = Session.create('/repo', join(dir, 'mox'));
s.appendMessage({ role: 'user', content: '跑一下测试' });
s.appendMessage({ role: 'assistant', content: [{ type: 'text', text: '好的。' }], stopReason: 'stop', usage });
appendFileSync(s.file!, '{"type":"message","id":"deadbeef","parentId":');      // 写到一半，进程被杀
const pi = SessionManager.create('/repo', join(dir, 'pi'));
pi.appendMessage({ role: 'user', content: '跑一下测试', timestamp: 0 });
pi.appendMessage(fauxAssistantMessage('好的。'));
appendFileSync(pi.getSessionFile()!, '{"type":"message","id":"deadbeef","parentId":');

console.log('情形一：最后一行只写了一半');
const reopened = Session.open(s.file!);
console.log(`  mox 重新打开：${roles(reopened.messages())}（坏行被跳过）`);
const piReopened = SessionManager.open(pi.getSessionFile()!, join(dir, 'pi'));
console.log(`  Pi  重新打开：${roles(piReopened.buildSessionContext().messages.filter((m: any) => m.role !== 'system'))}`);
reopened.appendMessage({ role: 'user', content: '再试一次' });
const lines = readFileSync(s.file!, 'utf8').trim().split('\n');
console.log(`  继续对话后，新记录接在最后一条完好的记录后面；文件共 ${lines.length} 行，坏行留在原处，读取时继续跳过`);

// ── 情形二：有调用没结果 ─────────────────────────────
const history: Message[] = [
  { role: 'user', content: '跑一下测试' },
  { role: 'assistant', stopReason: 'toolUse', usage, content: [{ type: 'toolCall', id: 't1', name: 'bash', arguments: { command: 'npm test' } }] },
  // ← 工具还没返回，进程崩溃。恢复后用户接着说话：
  { role: 'user', content: '刚才断了，继续' },
];
console.log('\n情形二：历史里有工具调用，没有结果');
console.log(`  保存的历史：${roles(history)}`);
console.log('  原样发给 Anthropic 会被拒绝：每个 tool_use 后面必须紧跟对应的 tool_result');
console.log(`  mox 发送前修复：${roles(repairTranscript(history))}`);
const piHistory = [
  { role: 'user', content: '跑一下测试', timestamp: 0 },
  fauxAssistantMessage(fauxToolCall('bash', { command: 'npm test' }, { id: 't1' }), { stopReason: 'toolUse' }),
  { role: 'user', content: '刚才断了，继续', timestamp: 1 },
];
const model = getModel('anthropic', 'claude-sonnet-4-5') as any;
console.log(`  Pi  发送前修复：${roles(transformMessages(piHistory as any, model))}`);

// ── 情形三：一条失败的回复夹在中间 ───────────────────
const withError: Message[] = [
  { role: 'user', content: '解释这个函数' },
  { role: 'assistant', stopReason: 'error', errorMessage: '连接中断', usage, content: [{ type: 'text', text: '这个函数的作用是' }] },
  { role: 'user', content: '再说一次' },
];
console.log('\n情形三：中间有一条失败的回复');
console.log(`  保存的历史：${roles(withError)}`);
console.log(`  mox 发送前：${roles(repairTranscript(withError))}（半截回复不重放）`);
const piWithError = [
  { role: 'user', content: '解释这个函数', timestamp: 0 },
  { ...fauxAssistantMessage('这个函数的作用是'), stopReason: 'error', errorMessage: '连接中断' },
  { role: 'user', content: '再说一次', timestamp: 1 },
];
console.log(`  Pi  发送前：${roles(transformMessages(piWithError as any, model))}`);
