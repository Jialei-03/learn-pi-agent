// 第 5 章实验：输出太长时，Pi 的工具保留哪一段、怎样告诉模型下一步。
//   node labs/ch05/pi-truncate.ts
//   read 读 5000 行的日志：2000 行先到，提示用 offset 接着读
//   read 读每行 1000 字符的宽文件、每行 1000 个汉字的文件：50KB（按字节）先到，只保留完整的行
//   bash 输出 20000 行：保留结尾（报错通常在最后），完整输出存进临时文件
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBashTool as piBash, createReadTool as piRead } from '@earendil-works/pi-coding-agent';

const dir = mkdtempSync(join(tmpdir(), 'ch05-trunc-'));
writeFileSync(join(dir, 'big.log'), Array.from({ length: 5000 }, (_, i) => `line ${i + 1}`).join('\n'));
writeFileSync(join(dir, 'wide.txt'), Array.from({ length: 100 }, (_, i) => `${i + 1}:` + 'x'.repeat(1000)).join('\n'));
writeFileSync(join(dir, 'zh.txt'), Array.from({ length: 100 }, (_, i) => `${i + 1}:` + '汉'.repeat(1000)).join('\n'));

const text = (r: any) => r.content.map((b: any) => b.text).join('');
const show = (title: string, out: string) => {
  const lines = out.split('\n');
  const clip = (s: string) => (s.length > 24 ? `${s.slice(0, 12)}…${s.slice(-8)}` : s);
  const notice = lines.filter(l => l.startsWith('[')).join(' ').replace(/\/[^\s\]]*(output|pi-bash)[^\s\]]*/g, '<临时文件>');
  console.log(`${title}\n  ${lines.length} 行，${Buffer.byteLength(out)} 字节；第一行 ${JSON.stringify(clip(lines[0]))}，最后一行 ${JSON.stringify(clip(lines.at(-1)!))}\n  提示：${notice || '（没有）'}\n`);
  return { lines, notice, bytes: Buffer.byteLength(out) };
};

const a = show('read big.log（5000 行，每行很短）', text(await piRead(dir).execute('1', { path: 'big.log' } as any)));
show('read big.log，offset=1990', text(await piRead(dir).execute('1', { path: 'big.log', offset: 1990 } as any)));
const b = show('read wide.txt（100 行，每行 1000 个字符）', text(await piRead(dir).execute('1', { path: 'wide.txt' } as any)));
const c = show('read zh.txt（100 行，每行 1000 个汉字）', text(await piRead(dir).execute('1', { path: 'zh.txt' } as any)));
const d = show('bash: seq 1 20000', text(await piBash(dir).execute('1', { command: 'seq 1 20000' } as any)));

assert.ok(a.notice.includes('offset=2001'));
assert.ok(b.notice.includes('50.0KB limit') && c.notice.includes('50.0KB limit'));
assert.ok(c.bytes < 52_000);                              // 汉字一个三字节：按字节算，只留下 17 行
assert.equal(d.lines[0], '18001');                        // 保留结尾
assert.ok(d.notice.includes('Full output'));
