// 第 21 章实战检验：把全课搭出来的 mox 组装起来，从头到尾跑一遍。
//   node labs/ch21/practice.ts                      检验参考实现 mox/
//   MOX_DIR=~/my-mox node labs/ch21/practice.ts     检验你自己的 mox（九个文件在 ~/my-mox/src/，goal 扩展在 ~/my-mox/extensions/goal.ts）
// 三部分：① map.ts——九个文件各自多少行、谁依赖谁，分层要对；② journey.ts——真正的 mox -p，带着项目说明、Skill、两个扩展、子 Agent，修一个 bug；③ order.ts——三个事件的三种汇总方式。
import { whose } from '../shared/mox-dir.ts';

console.log(`${whose()}\n`);
for (const part of ['map', 'journey', 'order']) {
  console.log(`\n══════ ${part}.ts ══════\n`);
  await import(`./${part}.ts`);
}
