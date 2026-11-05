// 第 20 章实战检验：给 mox 做评测。
//   node labs/ch20/practice.ts                      用参考实现 evals/ 评测参考实现 mox/
//   MOX_DIR=~/my-mox node labs/ch20/practice.ts     评测你自己的 mox；如果 ~/my-mox/evals/harness.ts 存在，也用你自己写的评测框架
// 三部分：① 先测评测本身——24 个已知答案的脚本 Agent 必须被评分器分对；② 评测框架该有的行为：运行出错不算失败、变体真的传到了 mox 里；③ 统计：区间和符号检验。
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CASES } from '../../evals/cases.ts';
import * as reference from '../../evals/harness.ts';
import { startFakeModel } from '../shared/mox-cli.ts';
import { MOX_DIR, usingReference, whose } from '../shared/mox-dir.ts';
import { validate } from './validate.ts';

console.log(`${whose()}\n`);
const mine = join(MOX_DIR, 'evals', 'harness.ts');
const harness: typeof reference = !usingReference && existsSync(mine) ? await import(pathToFileURL(mine).href) : reference;
console.log(`评测框架：${harness === reference ? '参考实现 evals/harness.ts' : mine}\n`);

console.log('══════ ① 先测评测本身 ══════\n');
await validate(harness, CASES);

console.log('\n══════ ② 框架的行为 ══════\n');
const fixBug = CASES.find(c => c.id === 'fix-bug')!;
// 模型服务一直返回错误（连不上）：这是“无效观测”，不是“任务失败”
const dead = await harness.runOnce(fixBug, { name: 'x' }, { baseUrl: 'http://127.0.0.1:1', apiKey: 'x', model: 'fake' });
console.log(`模型服务连不上：error = ${JSON.stringify(dead.result.error)}，评分 = ${dead.grade.note}`);
assert.ok(dead.result.error, '运行出错要标成 error');
assert.match(dead.grade.note, /运行出错/);

// 变体的提示真的传到了 mox 的系统提示里（靠 ~/.mox/AGENTS.md）
let system = '';
const spy = await startFakeModel(request => { system = request.messages[0].content; return { text: '好了' }; });
await harness.runOnce(fixBug, { name: 'B', notes: '变体 B 的特别说明：ZEBRA-42' }, { baseUrl: spy.url, apiKey: 'x', model: 'fake' });
spy.close();
console.log(`变体 B 的 notes 出现在 mox 的系统提示里：${system.includes('ZEBRA-42') ? '是' : '否'}`);
assert.ok(system.includes('ZEBRA-42'));


console.log('\n══════ ③ 统计 ══════\n');
const [lo, hi] = harness.wilson(9, 12);
console.log(`12 次里通过 9 次：95% 区间 ${Math.round(lo * 100)}%–${Math.round(hi * 100)}%`);
assert.ok(lo > 0.4 && lo < 0.5 && hi > 0.9 && hi < 0.95);
console.log(`符号检验：只有 A 通过 4 对、只有 B 通过 0 对 → p = ${harness.signTest(4, 0).toFixed(3)}；8 对比 0 对 → p = ${harness.signTest(8, 0).toFixed(3)}`);
assert.ok(Math.abs(harness.signTest(4, 0) - 0.125) < 1e-9 && harness.signTest(8, 0) < 0.01);
