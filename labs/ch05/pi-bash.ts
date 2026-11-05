// 第 5 章实验：Pi 的 bash 工具，命令超时或被取消之后，它启动的子进程还活着吗？
//   node labs/ch05/pi-bash.ts
// 命令在后台再启动一个 sleep（模拟 npm test 拉起的测试进程），自己也 sleep 3 秒。
// 超时设 1 秒，或者 0.5 秒后取消；1.5 秒时数一数这条命令的 sleep 进程还剩几个。最后看非零退出码怎么算。
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createBashTool as piBash } from '@earendil-works/pi-coding-agent';

// 模式写成 [s]leep：pgrep 自己（以及启动它的 sh）的命令行里不会匹配到这个模式
const count = (tag: string) => { try { return execSync(`pgrep -f "[s]leep ${tag}"`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length; } catch { return 0; } };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

console.log('| 情形 | 1.5 秒时还活着的子进程 | 工具返回用了 | 抛出的错误 |');
console.log('| --- | --- | --- | --- |');
let n = 0;
for (const scenario of ['超时 1 秒', '0.5 秒后取消'] as const) {
  const tag = `3.${200 + ++n}`;
  const controller = new AbortController();
  const start = performance.now();
  let seconds = 0;
  const call = piBash(tmpdir()).execute('1', { command: `sleep ${tag} & sleep ${tag}; wait`, timeout: scenario === '超时 1 秒' ? 1 : undefined } as any, controller.signal)
    .then(() => '（没有抛错）', e => (e as Error).message.replace(/\n+/g, ' ').trim())
    .finally(() => { seconds = Math.round((performance.now() - start) / 500) / 2; });
  if (scenario !== '超时 1 秒') setTimeout(() => controller.abort(), 500);
  await wait(1500);
  const alive = count(tag);
  const error = await call;
  console.log(`| ${scenario} | ${alive} | 约 ${seconds} 秒 | ${error} |`);
  assert.equal(alive, 0);
  assert.ok(seconds <= 1.5);
}

const r: any = await piBash(tmpdir()).execute('1', { command: 'echo 失败了 >&2; exit 3' } as any);
console.log(`\n命令 \`echo 失败了 >&2; exit 3\`：isError=${r.isError}，内容：${r.content.map((b: any) => b.text).join('').replace(/\n+/g, ' / ')}`);
assert.equal(r.isError, true);
