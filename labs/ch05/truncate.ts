// 第 5 章实验：输出太长时，mox 和 Pi 的工具分别保留哪一段、怎样告诉模型下一步。
//   node labs/ch05/truncate.ts
//   read 读 5000 行的日志：mox 和 Pi 都在 2000 行处停下，并告诉模型用 offset 接着读
//   read 读一个每行 1000 字符的宽文件：50KB 先到，两边都只保留完整的行
//   read 读一个每行 1000 个汉字的文件：“50KB”按字节算（mox 早先按字符数，会多读三倍，这里用一个模拟保留修复前的数字）
//   bash 输出 20000 行：两边都保留结尾；Pi 把完整输出另存临时文件，mox 只说省略了多少
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBashTool as piBash, createReadTool as piRead } from '@earendil-works/pi-coding-agent';
import { codingTools } from '../../mox/src/tools.ts';

const dir = mkdtempSync(join(tmpdir(), 'ch05-trunc-'));
writeFileSync(join(dir, 'big.log'), Array.from({ length: 5000 }, (_, i) => `line ${i + 1}`).join('\n'));
writeFileSync(join(dir, 'zh.txt'), Array.from({ length: 100 }, (_, i) => `${i + 1}:` + '汉'.repeat(1000)).join('\n'));
writeFileSync(join(dir, 'wide.txt'), Array.from({ length: 100 }, (_, i) => `${i + 1}:` + 'x'.repeat(1000)).join('\n'));

const tools = codingTools(dir);
const [read, bash] = ['read', 'bash'].map(name => tools.find(t => t.name === name)!);
const text = (r: any) => (typeof r === 'string' ? r : r.content.map((b: any) => b.text).join(''));

/** 描述一段输出：多少行、第一行和最后一行是什么、里面有哪些给模型的提示。 */
function describe(out: string) {
  const lines = out.split('\n');
  const clip = (s: string) => (s.length > 24 ? `${s.slice(0, 12)}…${s.slice(-8)}` : s);
  const notices = lines.filter(l => /^\[|省略/.test(l)).map(l => l.replace(/\/[^\s\]）]*(output|pi-bash)[^\s\]）]*/g, '<临时文件>').replace(/\.{0,1}…（?中间省略/, '…（中间省略').trim());
  return { count: lines.length, bytes: Buffer.byteLength(out), first: clip(lines[0]), last: clip(lines.at(-1)!), notices };
}
const show = (label: string, out: string) => {
  const d = describe(out);
  console.log(`  ${label.padEnd(4)} ${String(d.count).padStart(5)} 行 ${String(Buffer.byteLength(out)).padStart(7)} 字节   第一行 ${JSON.stringify(d.first)}   最后一行 ${JSON.stringify(d.last)}`);
  console.log(`       提示：${d.notices.length ? d.notices.map(n => n.slice(0, 110)).join(' ｜ ') : '（没有）'}`);
  return d;
};

console.log('read big.log（5000 行，每行很短）');
const m1 = show('mox', await read.run({ path: 'big.log' }));
const p1 = show('Pi', text(await piRead(dir).execute('1', { path: 'big.log' } as any)));
console.log('\nread big.log offset=1990');
show('mox', await read.run({ path: 'big.log', offset: 1990 }));
show('Pi', text(await piRead(dir).execute('1', { path: 'big.log', offset: 1990 } as any)));
console.log('\nread wide.txt（100 行，每行 1000 个字符）');
const m3 = show('mox', await read.run({ path: 'wide.txt' }));
const p3 = show('Pi', text(await piRead(dir).execute('1', { path: 'wide.txt' } as any)));
console.log('\nread zh.txt（100 行，每行 1000 个汉字）');
const m5 = show('mox', await read.run({ path: 'zh.txt' }));
const p5 = show('Pi', text(await piRead(dir).execute('1', { path: 'zh.txt' } as any)));
// 修复前的 mox 数的是字符（string.length），这里按那个规则模拟：每行 1000 个汉字加行号，一行 1003 个字符
const zhLines = Array.from({ length: 100 }, (_, i) => `${i + 1}:` + '汉'.repeat(1000));
let oldCount = 0;
for (let size = 0; oldCount < zhLines.length && (size += zhLines[oldCount].length + 1) <= 50 * 1024; oldCount++);
const oldBytes = Buffer.byteLength(zhLines.slice(0, oldCount).join('\n'));
console.log(`  早先的 mox（按字符数累加，模拟）：读 ${oldCount} 行，${oldBytes} 字节`);
console.log('\nbash: seq 1 20000');
const m4 = show('mox', await bash.run({ command: 'seq 1 20000' }));
const p4 = show('Pi', text(await piBash(dir).execute('1', { command: 'seq 1 20000' } as any)));

assert.ok(m1.notices.some(n => n.includes('offset=2001')) && p1.notices.some(n => n.includes('offset=2001')));   // 两边都告诉模型怎么继续
assert.ok(m3.notices.some(n => n.includes('offset=52')) && p3.notices.some(n => n.includes('offset=52')));       // 50KB 先到，只留整行
assert.ok(Math.abs(m5.bytes - p5.bytes) < 100);                     // 现在 mox 按字节算，和 Pi 只差提示文字的几个字节
assert.ok(oldBytes > 2.5 * p5.bytes);                               // 早先按字符数：中文文件里是 Pi 的三倍
assert.equal(m4.last, '[退出码 0]');
assert.ok(m4.first.startsWith('…（前面省略'));                    // mox：保留结尾，说明省略了多少
assert.ok(p4.notices.some(n => n.includes('Full output')));        // Pi：完整输出另存文件，把路径告诉模型
assert.ok(!m4.notices.some(n => n.includes('临时文件')));
