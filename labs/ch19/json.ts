// 第 19 章实验：mox --mode json，一次运行的完整事件流。
//   node labs/ch19/json.ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const r = spawnSync(process.execPath, [join(repo, 'mox/src/cli.ts'), '--mode', 'json', '--no-session', '-p', '构建项目'], {
  cwd: mkdtempSync(join(tmpdir(), 'ch19-json-')),
  env: { ...process.env, HOME: mkdtempSync(join(tmpdir(), 'ch19-home-')), MOX_API: 'scripted', MOX_SCRIPT: join(repo, 'labs/ch19/script.ts') },
  encoding: 'utf8',
});
const events = r.stdout.trim().split('\n').map(l => JSON.parse(l));
// 连续的同类事件合并显示
const seq: string[] = [];
for (const e of events) {
  const name = e.type === 'message_end' ? `message_end(${e.message.role})` : e.type;
  const last = seq.at(-1);
  if (last && last.replace(/ ×\d+$/, '') === name) seq[seq.length - 1] = `${name} ×${Number(last.match(/×(\d+)$/)?.[1] ?? 1) + 1}`;
  else seq.push(name);
}
console.log(`stdout 上共 ${events.length} 行，每行一个 JSON 事件：\n  ${seq.join('\n  ')}`);
const deltas = events.filter(e => e.type === 'text_delta').map(e => e.delta).join('');
const final = events.filter(e => e.type === 'message_end' && e.message.role === 'assistant').at(-1).message.content.find((b: any) => b.type === 'text').text;
console.log(`\n用 text_delta 拼出来的文字：${JSON.stringify(deltas)}`);
console.log(`最后一条 message_end 里的文字：${JSON.stringify(final)}（以它为准：增量只用来实时显示）`);
console.log(`stderr 上的内容（给人看的，不是协议）：${JSON.stringify(r.stderr.trim()) || '无'}`);
