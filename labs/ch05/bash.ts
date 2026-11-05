// 第 5 章实验：命令超时或被取消之后，它启动的子进程还活着吗？工具多久才返回？
//   node labs/ch05/bash.ts
// 命令在后台再启动一个 sleep（模拟 npm test 拉起的测试进程），自己也 sleep 3 秒。
// 三个实现：
//   朴素实现：mox 早先的写法（课程第一版），用 spawn 的 timeout / signal 选项，等 close 事件
//   mox     ：现在的 bash 工具，detached 进程组，超时和取消时 SIGKILL 整个组
//   Pi      ：Pi 的 bash 工具
//   超时情形：timeout 设成 1 秒
//   取消情形：0.5 秒后触发 AbortSignal
// 每个情形都在“1.5 秒时”数一数这条命令的 sleep 进程还剩几个，并记录工具最终用了多久才返回。
import assert from 'node:assert/strict';
import { execSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createBashTool as piBash } from '@earendil-works/pi-coding-agent';
import { loadMox, whose } from '../shared/mox-dir.ts';

const { codingTools } = await loadMox('tools.ts');
console.log(`${whose()}\n`);

// 模式写成 [s]leep：pgrep 自己（以及启动它的 sh）的命令行里不会匹配到这个模式
const count = (tag: string) => {
  try { return execSync(`pgrep -f "[s]leep ${tag}"`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length; } catch { return 0; }
};
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

const moxBash = codingTools(tmpdir()).find((t: any) => t.name === 'bash')!;

/** 朴素实现：mox 早先版本的 bash。超时和取消只向 bash 这一个进程发 SIGTERM，等所有输出管道关闭才返回。 */
const naiveBash = (command: string, timeout = 120, signal?: AbortSignal) =>
  new Promise<string>((done, fail) => {
    const child = spawn('bash', ['-c', command], { cwd: tmpdir(), signal, timeout: timeout * 1000 });
    let output = '';
    child.stdout.on('data', d => (output += d));
    child.stderr.on('data', d => (output += d));
    child.on('close', (code, killedBy) => done(`${output}\n[${code === null ? `被 ${killedBy} 终止` : `退出码 ${code}`}]`));
    child.on('error', e => fail(new Error(e.name === 'AbortError' ? '已取消' : e.message)));
  });

type Out = { text: string; isError: boolean };
const impls: [string, (command: string, timeout?: number, signal?: AbortSignal) => Promise<Out>][] = [
  ['朴素实现', async (command, timeout, signal) => ({ text: await naiveBash(command, timeout, signal), isError: false })],
  // mox 的 run 只返回字符串；抛出的异常由 runLoop 记成错误结果
  ['mox', async (command, timeout, signal) => {
    try { return { text: String(await moxBash.run({ command, timeout }, signal)), isError: false }; }
    catch (e) { return { text: (e as Error).message, isError: true }; }
  }],
  ['Pi', async (command, timeout, signal) => {
    const r: any = await piBash(tmpdir()).execute('1', { command, timeout } as any, signal);
    return { text: r.content.map((b: any) => b.text).join(''), isError: !!r.isError };
  }],
];

type Row = { name: string; scenario: string; alive: number; seconds: number; result: string; error: boolean };
const rows: Row[] = [];
let n = 0;
for (const [name, run] of impls) {
  for (const scenario of ['超时 1 秒', '0.5 秒后取消'] as const) {
    const tag = `3.${100 + ++n}`;                                // 每次用不同的 sleep 时长，方便分别统计
    const command = `sleep ${tag} & sleep ${tag}; wait`;
    const controller = new AbortController();
    const start = performance.now();
    let seconds = 0;
    const call = run(command, scenario === '超时 1 秒' ? 1 : undefined, controller.signal)
      .then(r => ({ text: r.text, error: r.isError }), e => ({ text: (e as Error).message, error: true }))
      .finally(() => { seconds = Math.round((performance.now() - start) / 500) / 2; });
    if (scenario !== '超时 1 秒') setTimeout(() => controller.abort(), 500);
    await wait(1500);
    const alive = count(tag);
    const result = await call;
    rows.push({ name, scenario, alive, seconds, result: result.text.replace(/\n+/g, ' ').trim(), error: result.error });
    try { execSync(`pkill -f "[s]leep ${tag}"`); } catch {}
  }
}

console.log('| 实现 | 情形 | 1.5 秒时还活着的子进程 | 工具返回用了 | 记为错误 | 工具返回的内容 |');
console.log('| --- | --- | --- | --- | --- | --- |');
for (const r of rows) console.log(`| ${r.name} | ${r.scenario} | ${r.alive} | 约 ${r.seconds} 秒 | ${r.error ? '是' : '否'} | ${r.result} |`);

console.log('\n命令 `echo 失败了 >&2; exit 3` 的返回：');
for (const [name, run] of impls) {
  const r = await run('echo 失败了 >&2; exit 3');
  console.log(`  ${name.padEnd(10)} 标记为错误：${String(r.isError).padEnd(5)} 内容：${r.text.replace(/\n+/g, ' / ')}`);
}

const by = (name: string, scenario: string) => rows.find(r => r.name === name && r.scenario === scenario)!;
assert.equal(by('朴素实现', '超时 1 秒').alive, 2);                // 朴素实现：bash 被 SIGTERM 杀了，两个 sleep 成了孤儿
assert.ok(by('朴素实现', '超时 1 秒').seconds >= 3);                // 孤儿握着管道，工具一直等到它们自己结束
assert.equal(by('朴素实现', '0.5 秒后取消').alive, 2);              // 取消时工具立刻返回，但子进程还在跑
for (const name of ['mox', 'Pi']) {
  for (const scenario of ['超时 1 秒', '0.5 秒后取消']) {
    assert.equal(by(name, scenario).alive, 0);
    assert.ok(by(name, scenario).seconds <= 1.5);
  }
}
