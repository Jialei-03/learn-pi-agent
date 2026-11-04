// 第 19 章实验：为什么线上的事件只带增量，不带“到目前为止的完整消息”？
//   node labs/ch19/delta-size.ts
// SDK 里的 message_update 事件带着累计快照（event.message，以及 assistantMessageEvent.partial）：订阅者随时能拿到“目前为止的完整消息”。
// 如果原样写到 stdout，一条 N 个增量的回复要写 O(N²) 的字节。Pi 的 JSON / RPC 模式用 toJsonEvent 去掉快照。
// 这里用真实的 AgentSession 收集 SDK 事件，再用 Pi 自己的 toJsonEvent 转成线上的形状，比较两者的字节数。
import assert from 'node:assert/strict';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/compat';
// toJsonEvent 没有从包的入口导出，按文件路径直接引入（路径导入不经过 package.json 的 exports）
import { toJsonEvent } from '../../node_modules/@earendil-works/pi-coding-agent/dist/modes/json-event.js';
import { createPiSession } from '../shared/pi-session.ts';

Math.random = () => 0.5;                    // 脚本模型的 id 里有随机数：固定它，字节数才稳定

async function measure(chars: number) {
  const reply = '这是一段很长的回答，用来观察事件的体积。'.repeat(Math.ceil(chars / 20)).slice(0, chars);
  // tokenSize 的 min = max：每个增量固定 4×4 = 16 个字符
  const { session } = await createPiSession({ responses: [fauxAssistantMessage(reply)], faux: { tokenSize: { min: 4, max: 4 } } });
  const events: any[] = [];
  session.subscribe(e => { if (e.type === 'message_update') events.push(e); });
  await session.prompt('写一段话');
  session.dispose();
  const bytes = (f: (e: any) => unknown) => events.reduce((n, e) => n + JSON.stringify(f(e)).length, 0);
  return { chars, events: events.length, sdk: bytes(e => e), wire: bytes(toJsonEvent) };
}

const rows = [await measure(400), await measure(1600), await measure(6400)];
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
console.log('| 回复长度 | message_update 事件数 | SDK 形状的总字节 | 线上形状的总字节 | 两者之比 |\n| --- | --- | --- | --- | --- |');
for (const r of rows) console.log(`| ${r.chars} 字 | ${r.events} | ${kb(r.sdk)} | ${kb(r.wire)} | ${(r.sdk / r.wire).toFixed(1)} 倍 |`);
const growth = (f: (r: typeof rows[0]) => number) => `${(f(rows[1]) / f(rows[0])).toFixed(1)} 倍、${(f(rows[2]) / f(rows[1])).toFixed(1)} 倍`;
console.log(`\n回复长度每变成 4 倍：\n  SDK 形状的流量变成 ${growth(r => r.sdk)}（趋近 16 倍：平方增长）\n  线上形状的流量变成 ${growth(r => r.wire)}（线性增长）`);

assert.ok(rows[1].sdk / rows[0].sdk > 8 && rows[2].sdk / rows[1].sdk > 12, 'SDK 形状：接近平方增长');
for (const [a, b] of [[rows[0], rows[1]], [rows[1], rows[2]]]) assert.ok(Math.abs(b.wire / a.wire - 4) < 0.3, '线上形状：线性增长');
assert.ok(rows[2].sdk / rows[2].wire > 20);
