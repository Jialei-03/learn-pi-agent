// 第 19 章实验：mox -p，一次性的打印模式。stdout 上是什么，退出码是什么，失败的时候谁看得出来？
//   node labs/ch19/print.ts
// 跑的是真正的 mox 命令行。三种结局：回答完成；工具需要确认但没有终端；模型服务返回错误。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI as cli, startFakeModel, type CliScript } from '../shared/mox-cli.ts';
import { whose } from '../shared/mox-dir.ts';

console.log(`${whose()}\n`);


/** 跑 mox -p，stdout 和 stderr 分开收 */
function run(url: string, args: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(resolve => {
    const child = spawn(process.execPath, [cli, '-p', ...args], {
      cwd: mkdtempSync(join(tmpdir(), 'ch19-print-')),
      env: { ...process.env, HOME: mkdtempSync(join(tmpdir(), 'ch19-home-')), MOX_BASE_URL: url, MOX_API_KEY: 'lab', MOX_MODEL: 'fake', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => (stdout += d));
    child.stderr.on('data', d => (stderr += d));
    child.on('close', code => resolve({ code, stdout: stdout.replace(/\x1b\[[0-9;]*m/g, ''), stderr }));
  });
}

const model = await startFakeModel(((_r, n) => (n === 1 ? { text: '构建完成，没有警告。' } : { text: '' })) as CliScript);
const ok = await run(model.url, ['总结一下构建情况']);
model.close();

const tool = await startFakeModel((({ messages }) => (messages.some(m => m.role === 'tool') ? { text: '好了。' } : { toolCalls: [{ name: 'bash', arguments: { command: 'echo hi' } }] })) as CliScript);
const denied = await run(tool.url, ['执行 echo hi']);
const yolo = await run(tool.url, ['执行 echo hi', '--yolo']);
tool.close();

// 一个永远返回 500 的“模型服务”
const broken = createServer((_req, res) => { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"服务暂时不可用"}'); });
await new Promise<void>(resolve => broken.listen(0, '127.0.0.1', resolve));
const failed = await run(`http://127.0.0.1:${(broken.address() as AddressInfo).port}`, ['总结一下构建情况']);
broken.close();

const show = (s: string) => s.trim().replace(/\n+/g, ' ⏎ ').slice(0, 90);
console.log('| 场景 | 退出码 | stdout | stderr |\n| --- | --- | --- | --- |');
console.log(`| 回答完成 | ${ok.code} | ${show(ok.stdout)} | ${show(ok.stderr) || '空'} |`);
console.log(`| 工具要确认，没有终端 | ${denied.code} | ${show(denied.stdout)} | ${show(denied.stderr) || '空'} |`);
console.log(`| 同上，加 --yolo | ${yolo.code} | ${show(yolo.stdout)} | ${show(yolo.stderr) || '空'} |`);
console.log(`| 模型服务返回 500 | ${failed.code} | ${show(failed.stdout)} | ${show(failed.stderr) || '空'} |`);
console.log('\n要点：错误信息也写在 stdout 上（cli.ts 的 print），所以脚本只看 stdout 分不出成败，要看退出码。');

assert.equal(ok.code, 0);
assert.equal(ok.stdout.trim(), '构建完成，没有警告。');
assert.equal(denied.code, 0, '工具被拒绝只是一条工具结果，模型照样回答，运行本身是成功的');
assert.match(denied.stdout, /没有终端可以确认/);
assert.match(yolo.stdout, /\bhi\b/);
assert.equal(failed.code, 1);
assert.match(failed.stdout, /模型请求失败（500）/);
assert.equal(failed.stderr, '');
