// 第 20 章：用真实模型跑一次 A/B 评测（需要 MOX_API_KEY，不在网站构建时运行；结果存成 recorded/live-eval-<名字>.json，live.ts 回放）。
//   eval "$(python3 …)"          # 设置 MOX_BASE_URL、MOX_API_KEY
//   node labs/ch20/live-eval.ts [models|prompt] [每个任务的轮数，默认 3] [并发数，默认 3]
// models：同一份 mox，换模型——MiniMax-M3.1-Flash 对 MiniMax-M3（课程里录制的就是这一个）。
// prompt：同一个模型，系统提示里多一段话（通过 ~/.mox/AGENTS.md 加进去），改 NOTES 就能试自己的提示。
import { writeFileSync } from 'node:fs';
import { CASES } from '../../evals/cases.ts';
import { report, runEval, type Observation, type RunResult, type Variant } from '../../evals/harness.ts';
import { outline, summarize } from '../../evals/trajectory.ts';

const [kind = 'models', runsArg = '3', concurrencyArg = '3'] = process.argv.slice(2);
const runs = Number(runsArg), concurrency = Number(concurrencyArg);
if (!process.env.MOX_API_KEY || !process.env.MOX_BASE_URL) throw new Error('需要设置 MOX_BASE_URL、MOX_API_KEY');

const NOTES = '修改代码之后，必须实际验证：运行项目里已有的测试，或者写一小段脚本调用你改过的函数，确认结果正确再结束。';
const variants: Variant[] = kind === 'prompt'
  ? [{ name: 'A 默认', model: 'MiniMax-M3.1-Flash' }, { name: 'B 加一段话', model: 'MiniMax-M3.1-Flash', notes: NOTES }]
  : [{ name: 'A Flash', model: 'MiniMax-M3.1-Flash' }, { name: 'B M3', model: 'MiniMax-M3' }];

console.log(`${CASES.length} 个任务 × ${variants.length} 个变体 × ${runs} 轮 = ${CASES.length * variants.length * runs} 次运行，并发 ${concurrency}\n`);
const kept: { o: Observation; result: RunResult }[] = [];
const verified: Record<string, number[]> = {};
const started = Date.now();
const observations = await runEval(CASES, variants, {}, runs, {
  concurrency,
  retries: 3,
  onObservation: o => console.log(`${o.case.padEnd(18)} ${o.variant.padEnd(10)} 第 ${o.run} 轮  ${o.error ? `⚠ ${o.error.slice(0, 40)}` : o.pass ? '✓' : '✗'}${o.retries ? `（重跑 ${o.retries} 次）` : ''}  ${o.turns} 轮 ${o.toolCalls} 次工具调用  ${(o.ms / 1000).toFixed(0)}s  ${o.pass ? '' : o.note.slice(0, 60)}`),
  onRun: (o, result) => {
    if (!o.pass) kept.push({ o, result });
    const s = summarize(result.messages);
    if ((s.tools.edit ?? 0) + (s.tools.write ?? 0) > 0) (verified[o.variant] ??= []).push(s.verifiedAfterLastEdit ? 1 : 0);
  },
});
console.log(`\n${report(observations, variants.map(v => v.name))}`);

const clean = (s: string) => s.replace(/\/(private\/)?var\/folders\/[^\s"'`]+/g, '<临时目录>').replace(/\/Users\/[^\s"'`]+/g, '<路径>');
const recording = {
  recordedAt: new Date().toISOString().slice(0, 10),
  command: `node labs/ch20/live-eval.ts ${kind} ${runs}`,
  seconds: Math.round((Date.now() - started) / 1000),
  concurrency,
  variants,
  cases: CASES.map(c => c.id),
  observations,
  verified,
  failures: kept.slice(0, 6).map(({ o, result }) => ({ case: o.case, variant: o.variant, run: o.run, note: clean(o.note), summary: summarize(result.messages), outline: outline(result.messages).map(clean) })),
};
writeFileSync(new URL(`./recorded/live-eval-${kind}.json`, import.meta.url), `${JSON.stringify(recording, null, 2)}\n`);
console.log(`\n已保存 labs/ch20/recorded/live-eval-${kind}.json（${recording.seconds} 秒）`);
