// 第 5 章实验：同样的修改请求，交给 mox 的 edit 和 Pi 真实的 edit 工具。
//   node labs/ch05/edit.ts
// 每个情形都在临时目录里准备一个文件，分别用两个工具修改，比较结果和磁盘上的字节。
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEditTool as piEdit } from '@earendil-works/pi-coding-agent';
import { createEditTool as moxEdit } from '../../mox/src/coding/edit.ts';

const cases = [
  { label: '精确匹配', file: 'let a = 1;\nlet b = 2;\n', edits: [{ oldText: 'let b = 2;', newText: 'let b = 3;' }] },
  { label: '两处修改，对照原文件匹配', file: 'a = 1\nb = 2\nc = 3\n', edits: [{ oldText: 'c = 3', newText: 'c = 30' }, { oldText: 'a = 1', newText: 'a = 10' }] },
  { label: '模型写了直引号，文件里是弯引号', file: 'title = “Mox”\nnote = ‘保留’\n', edits: [{ oldText: 'title = "Mox"', newText: 'title = "Mox Notes"' }] },
  { label: '行尾多了空格', file: 'function f() {   \n  return 1;\n}\n', edits: [{ oldText: 'function f() {\n  return 1;', newText: 'function f() {\n  return 2;' }] },
  { label: 'oldText 出现两次', file: 'x();\nx();\n', edits: [{ oldText: 'x();', newText: 'y();' }] },
  { label: '两段修改重叠', file: 'abcdef\n', edits: [{ oldText: 'abc', newText: '1' }, { oldText: 'cde', newText: '2' }] },
  { label: '找不到 oldText', file: 'hello\n', edits: [{ oldText: 'world', newText: '!' }] },
  { label: 'Windows 换行 + BOM', file: '﻿line1\r\nline2\r\n', edits: [{ oldText: 'line2', newText: 'LINE2' }] },
];

const show = (s: string) => JSON.stringify(s).replace(/\\uFEFF|﻿/g, '<BOM>');

async function attempt(tool: 'mox' | 'pi', dir: string, c: (typeof cases)[number]) {
  const path = 'notes.txt';                                    // 相对路径，由工具按 cwd 解析
  writeFileSync(join(dir, path), c.file);
  try {
    if (tool === 'mox') await moxEdit(dir).execute({ path, edits: c.edits }, { toolCallId: '1' });
    else await piEdit(dir).execute('1', { path, edits: c.edits } as any);
    return `✓ ${show(readFileSync(join(dir, path), 'utf8'))}`;
  } catch (error) {
    return `✗ ${(error as Error).message.split('\n')[0]}`;
  }
}

for (const c of cases) {
  console.log(`## ${c.label}`);
  console.log(`  原文件 ${show(c.file)}`);
  console.log(`  mox    ${await attempt('mox', mkdtempSync(join(tmpdir(), 'ch05-')), c)}`);
  console.log(`  Pi     ${await attempt('pi', mkdtempSync(join(tmpdir(), 'ch05-')), c)}\n`);
}
