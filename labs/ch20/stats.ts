// 第 20 章实验：跑几遍才够？用模拟代替真实模型，看清楚样本量的问题。
//   node labs/ch20/stats.ts
// 设定：4 个任务，变体 B 真的比 A 好——平均通过率 82.5% 对 72.5%。每个“实验”让每个任务各跑 n 遍，看能不能看出 B 更好。
import { wilson } from '../../evals/harness.ts';

let seed = 20261103;
const random = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const A = [0.9, 0.5, 0.6, 0.9];
const B = [0.9, 0.7, 0.8, 0.9];

function experiment(runs: number) {
  let a = 0, b = 0;
  for (let c = 0; c < A.length; c++) for (let r = 0; r < runs; r++) { if (random() < A[c]) a++; if (random() < B[c]) b++; }
  return { a, b, n: A.length * runs };
}

console.log('| 每个任务跑几遍 | 每个变体的样本数 | 看出 B 更好 | 看不出差别 | 结论反了（A 更好） | B 的 95% 区间平均宽度 |');
console.log('| --- | --- | --- | --- | --- | --- |');
for (const runs of [1, 3, 10, 30, 100]) {
  let better = 0, tie = 0, worse = 0, width = 0;
  const trials = 2000;
  for (let i = 0; i < trials; i++) {
    const { a, b, n } = experiment(runs);
    if (b > a) better++; else if (b === a) tie++; else worse++;
    const [lo, hi] = wilson(b, n);
    width += hi - lo;
  }
  const p = (x: number) => `${Math.round((x / trials) * 100)}%`;
  console.log(`| ${runs} | ${runs * 4} | ${p(better)} | ${p(tie)} | ${p(worse)} | ±${Math.round((width / trials / 2) * 100)} 个百分点 |`);
}
console.log('\n（每一行是 2000 次模拟实验的统计。真实的差距是 10 个百分点。）');
