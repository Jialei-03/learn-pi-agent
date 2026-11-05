// 第 5 章实验：“50KB”到底数的是字符还是字节？
//   node labs/ch05/truncate.ts
// 一个 100 行的文件，每行 1000 个汉字（一个汉字三个字节）。read 的上限是 2000 行或 50KB，先到先算。
//   早先的 mox 用 string.length 数，数的是字符；现在的 mox 按字节数（Buffer.byteLength）；Pi 按字节数。
// 修复前的数字用一个小模拟保留下来。
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReadTool as piRead } from '@earendil-works/pi-coding-agent';
import { loadMox, whose } from '../shared/mox-dir.ts';

const { codingTools } = await loadMox('tools.ts');
console.log(`${whose()}\n`);

const lines = Array.from({ length: 100 }, (_, i) => `${i + 1}:` + '汉'.repeat(1000));
const dir = mkdtempSync(join(tmpdir(), 'ch05-trunc-'));
writeFileSync(join(dir, 'zh.txt'), lines.join('\n'));
const read = codingTools(dir).find((t: any) => t.name === 'read');

// 修复前的 mox 数的是字符：每行 1003 个字符，累加到 51200 为止
let oldCount = 0;
for (let size = 0; oldCount < lines.length && (size += lines[oldCount].length + 1) <= 50 * 1024; oldCount++);
const oldBytes = Buffer.byteLength(lines.slice(0, oldCount).join('\n'));

const mox = String(await read.run({ path: 'zh.txt' }));
const pi = (await piRead(dir).execute('1', { path: 'zh.txt' } as any)).content.map((b: any) => b.text).join('');
const shown = (out: string) => out.split('\n').filter(l => !l.startsWith('[')).filter(Boolean).length;

console.log('| 实现 | 读出的行数 | 字节数 |');
console.log('| --- | --- | --- |');
console.log(`| 早先的 mox（数字符，模拟） | ${oldCount} | ${oldBytes} |`);
console.log(`| 现在的 mox（数字节） | ${shown(mox)} | ${Buffer.byteLength(mox)} |`);
console.log(`| Pi | ${shown(pi)} | ${Buffer.byteLength(pi)} |`);

assert.ok(Math.abs(Buffer.byteLength(mox) - Buffer.byteLength(pi)) < 100);   // 现在和 Pi 只差提示文字的几个字节
assert.ok(oldBytes > 2.5 * Buffer.byteLength(pi));                          // 早先按字符数：中文文件里是 Pi 的三倍
