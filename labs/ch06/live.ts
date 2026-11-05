// 第 6 章：回放用真实模型（MiniMax-M3.1-Flash，经 OpenAI 兼容接口）录制的两组数据，录制方法见 record-live.ts。
//   node labs/ch06/live.ts cache    只看提示缓存
//   node labs/ch06/live.ts tokens   只看 token 估算
//   node labs/ch06/live.ts          两个都看
//   1. 提示缓存：每次请求只在历史末尾追加一问一答，服务商报告的命中缓存的输入 token
//   2. token 估算：mox 最初的公式（JSON 字符数 / 4）、现在的 estimateTokens 与服务商数出来的真实 token 数
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { estimateTokens } from '../../mox/src/compact.ts';
import { samples } from './samples.ts';

const live = JSON.parse(readFileSync(new URL('./recorded/live.json', import.meta.url), 'utf8'));
const only = process.argv[2];   // 'cache' | 'tokens' | 不传
console.log(`录制：${live.model}，${live.recordedAt}\n`);
if (only !== 'tokens') {

console.log('① 提示缓存（系统提示 = 基本规则 + 30 行 AGENTS.md）\n');
console.log('| 第几次请求 | 未命中缓存的输入 | 命中缓存的输入 | 命中比例 |');
console.log('| --- | --- | --- | --- |');
for (const r of live.cache) console.log(`| ${r.request} | ${r.promptTokens - r.cachedTokens} | ${r.cachedTokens} | ${Math.round((r.cachedTokens / r.promptTokens) * 100)}% |`);

}

if (only !== 'cache') {
console.log('\n② token 估算：旧公式（JSON 字符数 / 4）、现在的 estimateTokens、服务商数出来的真实值\n');
console.log('| 样本 | 字符数 | 旧公式 | 现在的公式 | 真实 | 旧 / 真实 | 现在 / 真实 |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const t of live.tokens) console.log(`| ${t.label} | ${t.chars} | ${t.estimateOld} | ${t.estimate} | ${t.actual} | ${(t.estimateOld / t.actual).toFixed(2)} | ${(t.estimate / t.actual).toFixed(2)} |`);
const first = live.cache[0];
console.log(`\n第 1 次请求的整个上下文（系统提示几乎全是中文）：旧公式 ${first.estimateOld}，现在 ${first.estimate}，真实 ${first.promptTokens}；旧 / 真实 = ${(first.estimateOld / first.promptTokens).toFixed(2)}，现在 / 真实 = ${(first.estimate / first.promptTokens).toFixed(2)}`);

// 样本文本来自固定提交，估算值应该和录制时一致；不一致说明样本或 estimateTokens 变了，需要重新录制
for (const [i, sample] of samples.entries()) {
  const wrap = (text: string) => [{ role: 'user' as const, content: text }];
  assert.equal(estimateTokens(wrap(sample.text)) - estimateTokens(wrap('。')), live.tokens[i].estimate);
}
assert.ok(live.cache.slice(1).every((r: any) => r.cachedTokens / r.promptTokens > 0.85));   // 追加式的历史：第二次起绝大部分命中
assert.ok(live.cache.every((r: any) => r.cachedTokens % 128 === 0));                         // 命中的 token 数都是 128 的整数倍
assert.ok(first.estimateOld / first.promptTokens < 0.5);                                    // 旧公式：中文为主的上下文只估到真实的不到一半
assert.ok(Math.abs(first.estimate / first.promptTokens - 1) < 0.25);                         // 现在的公式：误差在 25% 以内
}
