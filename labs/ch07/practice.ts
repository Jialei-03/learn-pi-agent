// 第 7 章实战检验：mox/src/session.ts 能不能做到会话该做到的事？
//   node labs/ch07/practice.ts                 检验参考实现 mox/
//   MOX_DIR=~/my-mox node labs/ch07/practice.ts   检验你自己写的
// 五件事：文件延迟创建 + 逐条追加；-c 恢复同一个文件；压缩记录的回放；补“中断”；坏行和半行。
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMox, whose } from '../shared/mox-dir.ts';

const { openSession } = await loadMox('session.ts');
const tmp = (name: string) => realpathSync(mkdtempSync(join(tmpdir(), name)));
const home = tmp('ch07-practice-');
const cwd = '/proj';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const files = () => { const root = join(home, '.mox', 'sessions'); return readdirSync(root).flatMap(d => readdirSync(join(root, d)).map(f => join(root, d, f))); };
const call = (id: string) => ({ id, type: 'function' as const, function: { name: 'bash', arguments: '{}' } });
const rows: [string, string][] = [];
const check = (name: string, observed: string, ok: boolean) => { rows.push([name, `${ok ? '✓' : '✗'} ${observed}`]); assert.ok(ok, `${name}：${observed}`); };

console.log(whose() + '\n');
try {
  // 一、延迟创建，逐条追加
  const s = openSession(cwd, home);
  check('开一个新会话，还没说话', `磁盘上有 ${files().length} 个文件`, files().length === 0);
  s.save({ role: 'user', content: '你好' });
  s.save({ role: 'assistant', content: '你好！' });
  const lines = readFileSync(s.file, 'utf8').trim().split('\n');
  check('说了两句话', `文件 ${lines.length} 行，每行都是 JSON：${lines[0].slice(0, 44)}…`, lines.length === 2 && lines.every(l => JSON.parse(l)));

  // 二、恢复
  await sleep(5);
  const resumed = openSession(cwd, home, true);
  check('resume=true', `读回 ${resumed.messages.length} 条，文件相同：${resumed.file === s.file}`, resumed.file === s.file && resumed.messages.length === 2);
  const fresh = openSession(cwd, home);
  check('resume=false', `${fresh.messages.length} 条消息，文件名不同：${fresh.file !== s.file}`, fresh.messages.length === 0 && fresh.file !== s.file);

  // 三、压缩记录
  const summary = { role: 'user' as const, content: '（摘要）' };
  resumed.compacted(summary, 1);
  const afterCompact = openSession(cwd, home, true);
  check('追加 compact 记录（keep=1）后恢复', JSON.stringify(afterCompact.messages.map((m: any) => m.content)), JSON.stringify(afterCompact.messages) === JSON.stringify([summary, { role: 'assistant', content: '你好！' }]));

  // 四、补“中断”
  const home2 = tmp('ch07-practice2-');
  const t = openSession(cwd, home2);
  t.save({ role: 'user', content: '依次跑两个命令' });
  t.save({ role: 'assistant', content: null, tool_calls: [call('c1'), call('c2')] });
  t.save({ role: 'tool', tool_call_id: 'c1', content: '第一个命令的结果' });
  const r1 = openSession(cwd, home2, true);
  const interrupted = r1.messages.at(-1);
  check('第二个调用没有结果，恢复', `补了一条：${JSON.stringify(interrupted).slice(0, 60)}…`, interrupted.role === 'tool' && interrupted.tool_call_id === 'c2' && /中断/.test(interrupted.content));
  const r2 = openSession(cwd, home2, true);
  check('再恢复一次', `共 ${r2.messages.length} 条（不重复补）`, r2.messages.length === r1.messages.length);
  rmSync(home2, { recursive: true, force: true });

  // 五、坏行和半行
  const home3 = tmp('ch07-practice3-');
  const u = openSession(cwd, home3);
  u.save({ role: 'user', content: 'a' });
  u.save({ role: 'assistant', content: 'b' });
  appendFileSync(u.file, '{"type":"message","message":{"role":"user","con');       // 断电：最后一行只写了一半，没有换行
  const v = openSession(cwd, home3, true);
  check('末尾有半行，恢复', `读回 ${v.messages.length} 条，没有抛错`, v.messages.length === 2);
  v.save({ role: 'user', content: '新消息' });
  const w = openSession(cwd, home3, true);
  check('恢复后接着说话，再恢复', `读回 ${w.messages.map((m: any) => m.content).join('、')}`, w.messages.length === 3 && w.messages.at(-1).content === '新消息');
  rmSync(home3, { recursive: true, force: true });

  console.log('| 检查 | 观察到 |\n| --- | --- |');
  for (const [name, observed] of rows) console.log(`| ${name} | ${observed} |`);
} finally {
  rmSync(home, { recursive: true, force: true });
}
