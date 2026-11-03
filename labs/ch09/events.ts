// 第 9 章实验：一次带工具调用的运行，Pi 的扩展能收到哪些事件、按什么顺序？
//   node labs/ch09/events.ts
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/compat';
import { createPiSession } from '../shared/pi-session.ts';

const EVENTS = ['input', 'before_agent_start', 'agent_start', 'turn_start', 'context', 'before_provider_request', 'message_start', 'message_end',
  'tool_execution_start', 'tool_call', 'tool_result', 'tool_execution_end', 'turn_end', 'agent_end', 'agent_before_settle', 'agent_settled'];
const seen: string[] = [];
const { session } = await createPiSession({
  responses: [fauxAssistantMessage(fauxToolCall('read', { path: 'README.md' }, { id: 'r1' }), { stopReason: 'toolUse' }), fauxAssistantMessage('读完了。')],
  extensions: [(pi: any) => {
    for (const name of EVENTS) pi.on(name, (e: any) => { seen.push(name + (e?.message?.role ? `(${e.message.role})` : '')); });
  }],
});
await session.prompt('读一下 README');
session.dispose();
// 把连续出现的同一事件合并显示
const rows: string[] = [];
for (const name of seen) rows.at(-1)?.startsWith(name + ' ×') || rows.at(-1) === name ? (rows[rows.length - 1] = rows.at(-1)!.includes(' ×') ? rows.at(-1)!.replace(/×(\d+)/, (_m, n) => `×${+n + 1}`) : `${name} ×2`) : rows.push(name);
rows.forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${r}`));
