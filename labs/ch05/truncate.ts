// 第 5 章实验：输出太长时，两个工具分别保留哪一段、怎样告诉模型下一步。
//   node labs/ch05/truncate.ts
// read 读一个 5000 行的文件：保留开头，提示用 offset 继续。
// bash 输出 3000 行：保留结尾（报错通常在最后），完整输出存进临时文件。
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBashTool as piBash, createReadTool as piRead } from '@earendil-works/pi-coding-agent';
import { createBashTool as moxBash, createReadTool as moxRead } from '../../mox/src/coding/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'ch05-trunc-'));
writeFileSync(join(dir, 'big.log'), Array.from({ length: 5000 }, (_, i) => `line ${i + 1}`).join('\n'));

const text = (r: any) => (typeof r === 'string' ? r : typeof r.content === 'string' ? r.content : r.content.map((b: any) => b.text).join(''));
const summarize = (s: string) => {
  const lines = s.split('\n');
  const body = lines.filter(l => l.startsWith('line ') || /^\d+$/.test(l));
  const notice = lines.filter(l => l.startsWith('[')).join(' ').replace(/\/[^\s\]]*(output|pi-bash)[^\s\]]*/g, '<临时文件>');
  return `保留 ${body.length} 行（${body[0]} … ${body.at(-1)}） ${notice}`;
};

console.log('read big.log（5000 行）');
console.log('  mox ', summarize(text(await moxRead(dir).execute({ path: 'big.log' }, { toolCallId: '1' }))));
console.log('  Pi  ', summarize(text(await piRead(dir).execute('1', { path: 'big.log' } as any))));
console.log('\nread big.log offset=4990');
console.log('  mox ', summarize(text(await moxRead(dir).execute({ path: 'big.log', offset: 4990 }, { toolCallId: '1' }))));
console.log('  Pi  ', summarize(text(await piRead(dir).execute('1', { path: 'big.log', offset: 4990 } as any))));
console.log('\nbash: seq 1 3000');
console.log('  mox ', summarize(text(await moxBash(dir).execute({ command: 'seq 1 3000' }, { toolCallId: '1' }))));
console.log('  Pi  ', summarize(text(await piBash(dir).execute('1', { command: 'seq 1 3000' } as any))));
