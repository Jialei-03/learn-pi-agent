// 第 8 章实验：回放 Pi 真实的压缩（录制方法见 record.ts：Pi 的 prepareCompaction + compact，模型 MiniMax-M3.1-Flash）。
//   node labs/ch08/pi-replay.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rec = JSON.parse(readFileSync(new URL('./recorded/pi-summary.json', import.meta.url), 'utf8'));
console.log(`录制于 ${rec.recordedAt}，模型 ${rec.model}，保留额度 ${rec.keepRecentTokens} tokens。这段对话有三轮：先看项目结构；再修搜索的大小写 bug，测试还剩一个失败；最后用户选了方案，并要求以后改完都跑 lint。\n`);
console.log(`Pi 的切点落在第二轮的末尾附近（isSplitTurn = ${rec.isSplitTurn}）：第一轮 ${rec.summarized} 条消息交给第一次摘要，第二轮被切开的前 ${rec.turnPrefix} 条交给第二次摘要，两份合并成下面这份。\n`);
console.log(rec.summary);
assert.equal(rec.isSplitTurn, true);
assert.ok(rec.summary.includes('Turn Context (split turn)'));
assert.ok(rec.summary.includes('<modified-files>\nsrc/search.ts\n</modified-files>'));
