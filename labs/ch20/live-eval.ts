// 第 20 章：用真实模型跑一次 A/B 评测（需要 MOX_API_KEY，不在网站构建时运行）。
//   node labs/ch20/live-eval.ts [每个任务的轮数，默认 3]
// 变体 A 用 mox 默认的系统提示；变体 B 多一句“改完要验证”。
import { modelFromEnv } from '../../mox/src/cli.ts';
import { CASES } from '../../evals/cases.ts';
import { report, runEval, type RunResult, type Observation, type Variant } from '../../evals/harness.ts';
import { outline, summarize } from '../../evals/trajectory.ts';

const runs = Number(process.argv[2] ?? 3);
const model = modelFromEnv();
const variants: Variant[] = [
  { name: 'A 默认' },
  { name: 'B 要求验证', systemPromptSuffix: '修改代码之后，必须实际验证：运行项目里已有的测试，或者写一小段脚本调用你改过的函数，确认结果正确再结束。不要只凭阅读代码就宣布完成。' },
];
console.log(`模型：${model.id}；${CASES.length} 个任务 × ${variants.length} 个变体 × ${runs} 轮 = ${CASES.length * variants.length * runs} 次运行\n`);
const failures: { o: Observation; result: RunResult }[] = [];
const verified: Record<string, number[]> = {};
const observations = await runEval(CASES, variants, model, runs, o =>
  console.log(`${o.case.padEnd(16)} ${o.variant.padEnd(8)} 第 ${o.run} 轮  ${o.error ? '⚠ 出错' : o.pass ? '✓' : '✗'}  ${o.turns} 轮 ${o.toolCalls} 次工具调用  ${(o.ms / 1000).toFixed(0)}s  ${o.pass ? '' : o.note.slice(0, 50)}`),
  (o, result) => {
    if (!o.pass && !o.error) failures.push({ o, result });
    // 改过文件的运行里，最后一次修改之后有没有再验证
    const s = summarize(result.messages);
    if ((s.tools.edit ?? 0) + (s.tools.write ?? 0) > 0) (verified[o.variant] ??= []).push(s.verifiedAfterLastEdit ? 1 : 0);
  },
);
console.log(`\n${report(observations, variants.map(v => v.name))}`);
console.log(`\n改动了文件的运行中，最后一次修改之后又运行了命令验证的比例：${Object.entries(verified).map(([v, xs]) => `${v} ${xs.filter(Boolean).length}/${xs.length}`).join('；')}`);
for (const { o, result } of failures.slice(0, 2)) {
  const s = summarize(result.messages);
  console.log(`\n━━ 失败的轨迹：${o.case} / ${o.variant} / 第 ${o.run} 轮 ━━`);
  console.log(`评分：${o.note}`);
  console.log(`${s.turns} 轮；工具：${Object.entries(s.tools).map(([k, v]) => `${k}×${v}`).join(' ')}；工具出错 ${s.toolErrors} 次；重复的调用 ${s.repeatedCalls} 次；最后修改后验证过：${s.verifiedAfterLastEdit ? '是' : '否'}`);
  console.log(outline(result.messages).slice(0, 24).join('\n'));
}
