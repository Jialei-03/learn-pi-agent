// 第 5 章实验：同样的修改请求，交给 Pi 真实的 edit 工具。
//   node labs/ch05/pi-edit.ts
// 每个情形都在临时目录里准备一个文件，用 Pi 的 edit 修改，打印结果和磁盘上的字节。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEditTool as piEdit } from '@earendil-works/pi-coding-agent';

const cases = [
  { label: '精确匹配', file: 'let a = 1;\nlet b = 2;\n', edits: [['let b = 2;', 'let b = 3;']] },
  { label: '两处修改，对照原文件匹配', file: 'a = 1\nb = 2\nc = 3\n', edits: [['c = 3', 'c = 30'], ['a = 1', 'a = 10']] },
  { label: '模型写了直引号，文件里是弯引号', file: 'title = “Mox”\nnote = ‘保留’\n', edits: [['title = "Mox"', 'title = "Mox Notes"']] },
  { label: '行尾多了空格', file: 'function f() {   \n  return 1;\n}\n', edits: [['function f() {\n  return 1;', 'function f() {\n  return 2;']] },
  { label: 'oldText 出现两次', file: 'x();\nx();\n', edits: [['x();', 'y();']] },
  { label: '两段修改重叠', file: 'abcdef\n', edits: [['abc', '1'], ['cde', '2']] },
  { label: '找不到 oldText', file: 'hello\n', edits: [['world', '!']] },
  { label: 'Windows 换行 + BOM', file: '﻿line1\r\nline2\r\n', edits: [['line1\nline2', 'LINE1\nLINE2']] },
  { label: 'oldText 和 newText 一样', file: 'same\n', edits: [['same', 'same']] },
];
const show = (s: string) => JSON.stringify(s).replace(/\\uFEFF|﻿/g, '<BOM>');

const out: Record<string, { ok: boolean; text: string }> = {};
for (const c of cases) {
  const dir = mkdtempSync(join(tmpdir(), 'ch05-'));
  writeFileSync(join(dir, 'notes.txt'), c.file);
  try {
    await piEdit(dir).execute('1', { path: 'notes.txt', edits: c.edits.map(([oldText, newText]) => ({ oldText, newText })) } as any);
    out[c.label] = { ok: true, text: `✓ ${show(readFileSync(join(dir, 'notes.txt'), 'utf8'))}` };
  } catch (error) {
    out[c.label] = { ok: false, text: `✗ ${(error as Error).message.split('\n')[0]}` };
  }
  console.log(`## ${c.label}\n  原文件 ${show(c.file)}\n  Pi     ${out[c.label].text}\n`);
}
assert.ok(out['模型写了直引号，文件里是弯引号'].ok && out['行尾多了空格'].ok && out['Windows 换行 + BOM'].ok);   // 模糊匹配救回
assert.ok(out['模型写了直引号，文件里是弯引号'].text.includes('‘保留’'));                                       // 其他行的弯引号没有被顺手改掉
assert.ok(!out['oldText 出现两次'].ok && !out['两段修改重叠'].ok && !out['找不到 oldText'].ok && !out['oldText 和 newText 一样'].ok);
