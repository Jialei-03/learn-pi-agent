// 第 20 章：回放一次真实模型的 A/B 评测。录制方法见 live-eval.ts。
//   node labs/ch20/live.ts models    # MiniMax-M3.1-Flash 对 MiniMax-M3
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { report, type Observation } from '../../evals/harness.ts';

const kind = process.argv[2] ?? 'models';
const rec = JSON.parse(readFileSync(new URL(`./recorded/live-eval-${kind}.json`, import.meta.url), 'utf8'));
const observations: Observation[] = rec.observations;
const names: string[] = rec.variants.map((v: { name: string }) => v.name);
console.log(`录制于 ${rec.recordedAt}：${rec.cases.length} 个任务 × ${names.length} 个变体 × ${rec.observations.length / rec.cases.length / names.length} 轮 = ${rec.observations.length} 次运行，并发 ${rec.concurrency}，用时 ${Math.floor(rec.seconds / 60)} 分钟`);
console.log(`$ ${rec.command}`);
console.log(`变体：${rec.variants.map((v: any) => `${v.name} = ${v.model}${v.notes ? `，系统提示多一段：“${v.notes.slice(0, 24)}…”` : ''}`).join('；')}\n`);
console.log(report(observations, names));

// 同一个任务、同一个变体，三轮之间差多少：每一轮用了几个回合（模型请求）
const cases: string[] = rec.cases;
console.log('\n| 任务 | ' + names.map(n => `${n} 的回合数（三轮）`).join(' | ') + ' |\n| --- | ' + names.map(() => '---').join(' | ') + ' |');
for (const c of cases) console.log(`| ${c} | ${names.map(n => observations.filter(o => o.case === c && o.variant === n && !o.error).sort((x, y) => x.run - y.run).map(o => o.turns).join('、')).join(' | ')} |`);

// 成本：同一批任务，两个变体各花了多少
const valid = observations.filter(o => !o.error);
const total = (name: string, f: (o: Observation) => number) => valid.filter(o => o.variant === name).reduce((n, o) => n + f(o), 0);
const [a, b] = names;
console.log(`\n成本对比（${names.length === 2 ? `${b} 是 ${a} 的` : ''}）：估算输入 token ${(total(b, o => o.input) / total(a, o => o.input)).toFixed(1)} 倍，耗时 ${(total(b, o => o.ms) / total(a, o => o.ms)).toFixed(1)} 倍，工具调用 ${(total(b, o => o.toolCalls) / total(a, o => o.toolCalls)).toFixed(1)} 倍`);
const verified = Object.entries(rec.verified as Record<string, number[]>).map(([v, xs]) => `${v} ${xs.filter(Boolean).length}/${xs.length}`).join('；');
console.log(`改动了文件的运行中，最后一次修改之后又运行了命令验证的比例：${verified}`);

for (const f of rec.failures.slice(0, 2)) {
  console.log(`\n━━ 失败的轨迹：${f.case} / ${f.variant} / 第 ${f.run} 轮 ━━`);
  console.log(`评分：${f.note}`);
  console.log(`${f.summary.turns} 轮；工具：${Object.entries(f.summary.tools).map(([k, v]) => `${k}×${v}`).join(' ')}；工具出错 ${f.summary.toolErrors} 次；重复的调用 ${f.summary.repeatedCalls} 次；最后修改后验证过：${f.summary.verifiedAfterLastEdit ? '是' : '否'}`);
  console.log(f.outline.slice(0, 22).join('\n'));
}

assert.ok(observations.length >= 30);
assert.ok(valid.length >= observations.length * 0.9, '绝大多数观测有效');
