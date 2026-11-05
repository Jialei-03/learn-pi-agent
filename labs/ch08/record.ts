// 第 8 章：用真实模型录制一次压缩（需要 MOX_BASE_URL、MOX_API_KEY、MOX_MODEL；网站构建时不运行）。
//   eval "$(python3 /tmp/mox-keys.py minimax)"; export MOX_MODEL=MiniMax-M3.1-Flash
//   node labs/ch08/record.ts            两件事都做
//   node labs/ch08/record.ts summary    只重新录制摘要
// 做两件事，结果存进 labs/ch08/recorded/：
//   summary.json —— 一段修 bug 的对话交给 compact()，真实模型写出的摘要，连同发给它的请求
//   tokens.json  —— 同样长度的中文、英文、代码，服务商返回的真实 prompt_tokens（估算是回放时现算的）
import { writeFileSync } from 'node:fs';
import { compact } from '../../mox/src/compact.ts';
import { openai, type Msg } from '../../mox/src/model.ts';
import { conversation } from './conversation.ts';
import { probes } from './probes.ts';

const { MOX_BASE_URL, MOX_API_KEY, MOX_MODEL } = process.env;
if (!MOX_MODEL || !MOX_API_KEY) throw new Error('需要设置 MOX_BASE_URL、MOX_API_KEY、MOX_MODEL');
const real = openai({ baseUrl: MOX_BASE_URL, apiKey: MOX_API_KEY, model: MOX_MODEL });
const out = (name: string) => new URL(`./recorded/${name}`, import.meta.url);

// ── 一、摘要 ──
let sent: Msg[] = [];
const model: typeof real = async request => { sent = request.messages; return real(request); };
const messages = conversation();
const result = await compact(messages, model, 60);
writeFileSync(out('summary.json'), JSON.stringify({
  model: MOX_MODEL, recordedAt: new Date().toISOString().slice(0, 10), keepTokens: 60,
  request: sent[0].content, summary: result!.summary.content, kept: result!.keep,
}, null, 2) + '\n');
console.log(`摘要已录制：${(result!.summary.content as string).length} 个字符，保留最近 ${result!.keep} 条`);

if (process.argv[2] === 'summary') process.exit(0);

// ── 二、token 估算 ──
async function promptTokens(text: string) {
  const res = await fetch(`${MOX_BASE_URL!.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${MOX_API_KEY}` },
    body: JSON.stringify({ model: MOX_MODEL, max_tokens: 1, messages: [{ role: 'user', content: text }] }),
  });
  return (await res.json()).usage.prompt_tokens as number;
}
const baseline = await promptTokens('好');
const rows = [];
for (const [kind, text] of Object.entries(probes)) {
  const real = (await promptTokens(text)) - baseline;
  rows.push({ kind, chars: text.length, real });
}
writeFileSync(out('tokens.json'), JSON.stringify({ model: MOX_MODEL, recordedAt: new Date().toISOString().slice(0, 10), baseline, rows }, null, 2) + '\n');
console.log(rows);
