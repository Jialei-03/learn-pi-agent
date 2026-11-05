// 第 5 章实验：同样的修改请求，交给 mox 的 edit 和 Pi 真实的 edit 工具。
//   node labs/ch05/edit.ts
// 每个情形都在临时目录里准备一个文件，分别用两个工具修改，比较结果和磁盘上的字节。
// 两个工具的参数一样：{ path, edits: [{ oldText, newText }] }。区别在匹配：mox 只做精确匹配，Pi 找不到时还会模糊匹配。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEditTool as piEdit } from '@earendil-works/pi-coding-agent';
import { loadMox, whose } from '../shared/mox-dir.ts';

const { codingTools } = await loadMox('tools.ts');
console.log(`${whose()}\n`);

const cases = [
  { label: '精确匹配', file: 'let a = 1;\nlet b = 2;\n', edits: [['let b = 2;', 'let b = 3;']] },
  { label: '两处修改，对照原文件匹配', file: 'a = 1\nb = 2\nc = 3\n', edits: [['c = 3', 'c = 30'], ['a = 1', 'a = 10']] },
  { label: 'oldText 出现两次', file: 'x();\nx();\n', edits: [['x();', 'y();']] },
  { label: '找不到 oldText', file: 'hello\n', edits: [['world', '!']] },
  { label: '两段修改重叠', file: 'abcdef\n', edits: [['abc', '1'], ['cde', '2']] },
  { label: '行尾多了空格，模型没抄', file: 'function f() {   \nreturn 1;\n}\n', edits: [['function f() {\nreturn 1;', 'function f() {\nreturn 2;']] },
  { label: '模型写了直引号，文件里是弯引号', file: 'title = “Mox”\nnote = ‘保留’\n', edits: [['title = "Mox"', 'title = "Mox Notes"']] },
  { label: 'Windows 换行 + 多行 oldText', file: '\uFEFFline1\r\nline2\r\n', edits: [['line1\nline2', 'LINE1\nLINE2']] },
  { label: 'Windows 换行 + 单行 oldText', file: '\uFEFFline1\r\nline2\r\n', edits: [['line2', 'LINE2']] },
  { label: 'newText 里带着 $& 和 $1', file: 'price = 0\n', edits: [['price = 0', 'price = "$&" + "$1"']] },
  { label: 'oldText 和 newText 一样', file: 'same\n', edits: [['same', 'same']] },
];

const show = (s: string) => JSON.stringify(s).replace(/\\uFEFF|﻿/g, '<BOM>');

async function attempt(tool: 'mox' | 'pi', c: (typeof cases)[number]) {
  const dir = mkdtempSync(join(tmpdir(), 'ch05-'));
  writeFileSync(join(dir, 'notes.txt'), c.file);
  try {
    const edits = c.edits.map(([oldText, newText]) => ({ oldText, newText }));
    if (tool === 'mox') await codingTools(dir).find((t: any) => t.name === 'edit')!.run({ path: 'notes.txt', edits });
    else await piEdit(dir).execute('1', { path: 'notes.txt', edits } as any);
    return { ok: true, text: `✓ ${show(readFileSync(join(dir, 'notes.txt'), 'utf8'))}` };
  } catch (error) {
    return { ok: false, text: `✗ ${(error as Error).message.split('\n')[0]}` };
  }
}

const out: Record<string, { mox: Awaited<ReturnType<typeof attempt>>; pi: Awaited<ReturnType<typeof attempt>> }> = {};
for (const c of cases) {
  const [mox, pi] = [await attempt('mox', c), await attempt('pi', c)];
  out[c.label] = { mox, pi };
  console.log(`## ${c.label}`);
  console.log(`  原文件 ${show(c.file)}`);
  console.log(`  mox    ${mox.text}`);
  console.log(`  Pi     ${pi.text}\n`);
}

const r = (label: string) => out[label];
assert.ok(r('两处修改，对照原文件匹配').mox.ok && r('两处修改，对照原文件匹配').mox.text.includes('a = 10\\nb = 2\\nc = 30'));
assert.ok(!r('oldText 出现两次').mox.ok && !r('找不到 oldText').mox.ok && !r('两段修改重叠').mox.ok);   // 唯一性、找不到、重叠：mox 都报错
assert.ok(!r('行尾多了空格，模型没抄').mox.ok && r('行尾多了空格，模型没抄').pi.ok);                       // 模糊匹配是 Pi 才有的
assert.ok(!r('Windows 换行 + 多行 oldText').mox.ok && r('Windows 换行 + 多行 oldText').pi.ok);
assert.ok(r('Windows 换行 + 单行 oldText').mox.ok);
assert.ok(r('newText 里带着 $& 和 $1').mox.text.includes('$&'));                                          // 按位置切片拼接：$ 不会被当成替换模式
assert.ok(r('oldText 和 newText 一样').mox.ok && !r('oldText 和 newText 一样').pi.ok);                   // mox 照写不误，Pi 认为这次修改没有意义
