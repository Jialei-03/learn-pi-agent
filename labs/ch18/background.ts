// 第 18 章实验：后台命令。模型启动一个要跑一会儿的命令，先结束这一轮；命令结束时，Agent 被通知唤醒。
//   node labs/ch18/background.ts
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/compat';
import { createBackgroundExtension } from '../../extensions/background/index.ts';
import { createPiSession, textOf } from '../shared/pi-session.ts';
import { idle } from './shared.ts';

// 一个“构建”：每 150ms 输出一行，0.9 秒后以退出码 0 结束
const build = `node -e "let i=0; const t=setInterval(()=>{ console.log('building module ' + (++i)); if(i===6){ clearInterval(t); console.log('BUILD OK'); } }, 150)"`;
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const log: string[] = [];
const { session } = await createPiSession({
  responses: [
    fauxAssistantMessage(fauxToolCall('bash_background', { command: build }, { id: 'b1' }), { stopReason: 'toolUse' }),
    async () => { await new Promise(r => setTimeout(r, 350)); return fauxAssistantMessage(fauxToolCall('bash_output', { id: 1 }, { id: 'o1' }), { stopReason: 'toolUse' }); },
    fauxAssistantMessage('构建在后台进行，结束时我会收到通知。你可以先告诉我下一步做什么。'),
    (c: any) => { const note = c.messages.filter((m: any) => m.role !== 'system').map(textOf).find((t: string) => t.includes('后台命令')) ?? ''; return fauxAssistantMessage(`收到通知：${note.includes('BUILD OK') ? '构建成功（BUILD OK）' : '构建结束'}，可以继续部署了。`); },
  ],
  extensions: [createBackgroundExtension()],
});
session.subscribe((e: any) => {
  if (e.type === 'agent_start') log.push(`${at()} Agent 开始运行`);
  if (e.type === 'agent_end') log.push(`${at()} Agent 这次运行结束，空闲`);
  if (e.type === 'message_end' && e.message.role === 'toolResult') log.push(`${at()}   ${e.message.toolName} → ${textOf(e.message).split('\n').slice(0, 3).join(' / ')}`);
  if (e.type === 'message_end' && e.message.role === 'custom') log.push(`${at()}   通知：${textOf(e.message).split('\n').filter(Boolean).slice(0, 4).join(' / ')}`);
  if (e.type === 'message_end' && e.message.role === 'assistant') for (const b of e.message.content) if (b.type === 'text' && b.text) log.push(`${at()}   模型：${b.text}`);
});
await session.prompt('构建一下项目');
await idle(session, 1500);       // 等后台命令结束、通知唤醒的那一轮也跑完
console.log(log.join('\n'));
session.dispose();
