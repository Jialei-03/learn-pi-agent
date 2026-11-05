// 第 6 章：token 估算实验用的几段样本文本。README 取自录制时 mox 的提交 69cda3f（之后 README 改过措辞），保证和录制的真实 token 数对得上。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const text = (path: string) => readFileSync(new URL(path, root), 'utf8');
const rows = Array.from({ length: 30 }, (_, i) => ({ id: i, name: `item-${i}`, path: `/src/module${i}/index.ts`, size: 1000 + i * 37 }));

export const samples: { label: string; text: string }[] = [
  { label: '中文文档（mox/README.md 开头）', text: execFileSync('git', ['-C', new URL('mox', root).pathname, 'show', '69cda3f:README.md'], { encoding: 'utf8' }).slice(0, 1500) },
  { label: '英文文本（mox/LICENSE）', text: text('mox/LICENSE') },
  { label: 'TypeScript 代码，中文注释（mox/src/loop.ts）', text: text('mox/src/loop.ts') },
  { label: 'JSON 工具结果（30 条记录）', text: JSON.stringify(rows) },
];
