// 第 8 章实验：回放录制下来的真实压缩。
//   node labs/ch08/replay.ts            真实模型写出的摘要
//   node labs/ch08/replay.ts tokens     mox 的 token 估算和真实用量
// 录制方法见 record.ts（MiniMax-M3.1-Flash，需要 API Key）。回放时模型是脚本，原样返回录下来的回答，
// 所以 compact() 照常运行：它现在构造出的请求必须和录制时一模一样，不一样说明 mox 变了，录制过期，实验失败。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compact, estimateTokens } from '../../mox/src/compact.ts';
import { scripted } from '../shared/scripted.ts';
import { conversation } from './conversation.ts';
import { probes } from './probes.ts';

const load = (name: string) => JSON.parse(readFileSync(new URL(`./recorded/${name}`, import.meta.url), 'utf8'));

if (process.argv[2] === 'tokens') {
  const rec = load('tokens.json');
  const naive = (text: string) => Math.ceil(JSON.stringify(text).length / 4);      // 最朴素的公式：字符数 ÷ 4
  console.log(`录制于 ${rec.recordedAt}，模型 ${rec.model}。真实用量 = 服务商返回的 prompt_tokens 减去一条极短消息的 prompt_tokens（${rec.baseline}），也就是这段文字本身占的 token。\n`);
  console.log('| 文本 | 字符数 | 真实 token 数 | 字符数 ÷ 4 | 比值 | mox 现在的估算 | 比值 |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rec.rows) {
    const text = probes[r.kind];
    assert.equal(text.length, r.chars, '实验文字变了，需要重新录制');
    console.log(`| ${r.kind} | ${r.chars} | ${r.real} | ${naive(text)} | ${(naive(text) / r.real).toFixed(2)} | ${estimateTokens(text)} | ${(estimateTokens(text) / r.real).toFixed(2)} |`);
    if (r.kind === '中文') { assert.ok(naive(text) / r.real < 0.5); assert.ok(estimateTokens(text) / r.real > 1); }
    else assert.ok(Math.abs(estimateTokens(text) / r.real - 1) < 0.2);
  }
} else {
  const rec = load('summary.json');
  const prefix = '（更早的对话已经压缩成下面的摘要）\n';
  assert.ok(rec.summary.startsWith(prefix));
  const messages = conversation();
  const total = messages.length;
  const model = scripted([{ text: rec.summary.slice(prefix.length) }]);
  const result = await compact(messages, model, rec.keepTokens);
  assert.equal((model.requests[0].messages[0] as { content: string }).content, rec.request, 'compact 现在构造的请求和录制时不同，需要重新录制');
  assert.equal(result!.keep, rec.kept);
  console.log(`录制于 ${rec.recordedAt}，模型 ${rec.model}。这段修 bug 的对话共 ${total} 条消息，压缩了前 ${total - rec.kept} 条，原样保留最近 ${rec.kept} 条。\n`);
  console.log('**真实模型写出的摘要：**\n');
  console.log(rec.summary.slice(prefix.length));
  console.log('\n**压缩之后发给模型的消息：**\n');
  messages.forEach((m, i) => console.log(`${i + 1}. \`${m.role}\`：${String(m.content).replace(/\s+/g, ' ').slice(0, 60)}${String(m.content).length > 60 ? '……' : ''}`));
}
