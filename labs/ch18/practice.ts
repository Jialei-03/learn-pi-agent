// 第 18 章实战检验：给 mox 加上崩溃恢复（session.ts）、目标循环（goal 扩展）和后台命令（background 扩展）。
//   node labs/ch18/practice.ts                      检验参考实现 mox/ 和 extensions/{goal,background}/mox.ts
//   MOX_DIR=~/my-mox node labs/ch18/practice.ts     检验你自己的 mox（扩展放在 ~/my-mox/extensions/goal.ts 和 background.ts）
// 三部分依次运行：crash.ts（真实 kill -9 之后 mox -c 恢复）、goal.ts（目标循环）、background.ts（后台命令）。任何一部分的断言失败，进程以非 0 退出。
import { whose } from '../shared/mox-dir.ts';

console.log(`${whose()}\n`);
for (const part of ['crash', 'goal', 'background']) {
  console.log(`\n══════ ${part}.ts ══════\n`);
  await import(`./${part}.ts`);
}
