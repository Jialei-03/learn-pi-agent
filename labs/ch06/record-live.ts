// 录制两组真实数据（需要 MOX_BASE_URL、MOX_API_KEY、MOX_MODEL；网站构建时不运行，只读它生成的 JSON）。
//   MOX_BASE_URL=https://api.minimaxi.com/v1 MOX_API_KEY=… MOX_MODEL=MiniMax-M3.1-Flash node labs/ch06/record-live.ts
// mox 的 openai() 只取回消息，不读用量，所以这里直接请求 Chat Completions，读响应里的 usage：
//   cache  ：连续 4 次请求，系统提示来自 mox 的 systemPrompt()，每次在历史末尾追加一问一答，看命中缓存的 token
//   tokens ：几段样本文本的真实 token 数（用“样本 − 一个句号”的差消掉消息格式的固定开销），对照两个估算公式：
//            旧公式（JSON 字符数 / 4，mox 最初的写法）和现在的 estimateTokens（非 ASCII 字符约 0.7 个 token）
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { estimateTokens } from '../../mox/src/compact.ts';
import { systemPrompt } from '../../mox/src/context.ts';
import type { Msg } from '../../mox/src/model.ts';
import { samples } from './samples.ts';

/** mox 最初的估算：JSON 字符数 / 4。只留在录制里，用来对比。 */
const oldEstimate = (value: unknown) => Math.ceil(JSON.stringify(value).length / 4);

const { MOX_BASE_URL, MOX_API_KEY, MOX_MODEL } = process.env;
if (!MOX_BASE_URL || !MOX_API_KEY || !MOX_MODEL) throw new Error('请设置 MOX_BASE_URL、MOX_API_KEY、MOX_MODEL');
const [baseUrl, apiKey, modelName] = [MOX_BASE_URL, MOX_API_KEY, MOX_MODEL];

async function chat(messages: Msg[], maxTokens = 40) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: modelName, messages, max_tokens: maxTokens }),
  });
  if (!res.ok) throw new Error(`请求失败 ${res.status}：${(await res.text()).slice(0, 300)}`);
  const json: any = await res.json();
  return { content: json.choices[0].message.content as string, promptTokens: json.usage.prompt_tokens as number, cachedTokens: (json.usage.prompt_tokens_details?.cached_tokens ?? 0) as number };
}

// ── 缓存 ──
const cwd = mkdtempSync(join(tmpdir(), 'record-live-'));
mkdirSync(cwd, { recursive: true });
writeFileSync(join(cwd, 'AGENTS.md'), Array.from({ length: 30 }, (_, i) => `- 约定 ${i + 1}：函数名用动词开头，参数不超过 3 个，错误信息写成中文，不要吞掉异常。`).join('\n'));
const system: Msg = { role: 'system', content: systemPrompt(cwd, join(cwd, 'home'), []) };
const history: Msg[] = [];
const cache = [];
for (let i = 1; i <= 4; i++) {
  history.push({ role: 'user', content: `第 ${i} 个问题：用一句话回答，${i} + ${i} 等于几？` });
  const messages = [system, ...history];
  const reply = await chat(messages);
  history.push({ role: 'assistant', content: reply.content });
  cache.push({ request: i, estimateOld: oldEstimate(messages), estimate: estimateTokens(messages), promptTokens: reply.promptTokens, cachedTokens: reply.cachedTokens });
}

// ── 估算 ──
const wrap = (text: string): Msg[] => [{ role: 'user', content: text }];
const base = await chat(wrap('。'), 5);
const tokens = [];
for (const sample of samples) {
  const real = await chat(wrap(sample.text), 5);
  tokens.push({
    label: sample.label, chars: sample.text.length,
    estimateOld: oldEstimate(wrap(sample.text)) - oldEstimate(wrap('。')),
    estimate: estimateTokens(wrap(sample.text)) - estimateTokens(wrap('。')),
    actual: real.promptTokens - base.promptTokens,
  });
}

const out = JSON.stringify({ model: MOX_MODEL, recordedAt: new Date().toISOString().slice(0, 10), cache, tokens }, null, 2);
if (out.includes(apiKey)) throw new Error('录制文件里出现了 Key');
writeFileSync(new URL('./recorded/live.json', import.meta.url), `${out}\n`);
console.log(out);
