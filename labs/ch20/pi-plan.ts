// 第 20 章实验：Pi 的评测怎样把“任务 × 变体 × 重复”排成一份计划。
//   node labs/ch20/pi-plan.ts
// 直接运行 Pi 评测包里的 createTaskPlan（packages/evals/src/plan.ts，固定提交的源码）。
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const piSrc = process.env.PI_SRC ?? join(import.meta.dirname, '../../../pi-v1.5.0');
const { createTaskPlan, parseDiscoveredCases } = await import(pathToFileURL(join(piSrc, 'packages/evals/src/plan.ts')).href);

// vitest 发现的用例名必须是 “<eval set> > <case>”
const cases = parseDiscoveredCases([
  { file: 'evals/extensions.docs.eval.ts', name: 'extensions > adds the model' },
  { file: 'evals/models.docs.eval.ts', name: 'models > registers a provider' },
]);
const plan = createTaskPlan(cases, 'openai/gpt-x', 3);

console.log(`${cases.length} 个用例 × 2 个变体 × 3 次重复 = ${plan.length} 个运行，每个运行一个全新的容器。计划里的先后顺序：\n`);
console.log('| # | 用例 | 重复 | 变体 |\n| --- | --- | --- | --- |');
plan.slice(0, 6).forEach((t: any, i: number) => console.log(`| ${i + 1} | ${t.evalSet} > ${t.caseId} | ${t.runNumber} | ${t.variant} |`));
console.log('| … | | | |');

const throws = (f: () => unknown) => { try { f(); return '没有报错'; } catch (e) { return (e as Error).message; } };
console.log(`\n用例名写成 "just-one-part"：${throws(() => parseDiscoveredCases([{ file: 'x', name: 'just-one-part' }]))}`);
console.log(`同一个用例出现两次：${throws(() => parseDiscoveredCases([{ file: 'x', name: 'a > b' }, { file: 'y', name: 'a > b' }]))}`);
console.log(`模型写成 "gpt-x"（没有服务商）：${throws(() => createTaskPlan(cases, 'gpt-x', 1))}`);

assert.equal(plan.length, 12);
// 奇数次重复先 without_docs，偶数次先 with_docs：谁都不总是先跑
assert.deepEqual(plan.filter((t: any) => t.caseId === 'adds the model' && t.runNumber === 1).map((t: any) => t.variant), ['without_docs', 'with_docs']);
assert.deepEqual(plan.filter((t: any) => t.caseId === 'adds the model' && t.runNumber === 2).map((t: any) => t.variant), ['with_docs', 'without_docs']);
