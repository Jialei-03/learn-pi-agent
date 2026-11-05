// 第 7 章实验：一次真实的 mox 运行，会话文件里写下了什么？恢复时又怎样读回来？
//   node labs/ch07/jsonl.ts            会话文件长什么样，openSession 怎样读回来
//   node labs/ch07/jsonl.ts compact    追加一条 compact 记录之后，恢复出来的是什么
// 用真正的命令行跑一次小任务（模型是脚本），然后直接读会话文件。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSession } from '../../mox/src/session.ts';
import { runMox } from '../shared/mox-cli.ts';

const tmp = (name: string) => realpathSync(mkdtempSync(join(tmpdir(), name)));   // macOS 的 /var 实际是 /private/var，mox 用真实路径起目录名
const home = tmp('ch07-home-');
const project = tmp('ch07-proj-');
writeFileSync(join(project, 'notes.txt'), '买牛奶\n写周报\n');
const roles = (ms: { role: string }[]) => ms.map(m => m.role).join(' → ');

try {
  const run = await runMox(['-p', '看看 notes.txt 里有什么'], {
    cwd: project, home,
    script: (_request, n) => n === 1 ? { toolCalls: [{ name: 'read', arguments: { path: 'notes.txt' } }] } : { text: '两件事：买牛奶，写周报。' },
  });
  assert.equal(run.code, 0);
  const dir = join(home, '.mox', 'sessions', readdirSync(join(home, '.mox', 'sessions'))[0]);
  const file = join(dir, readdirSync(dir)[0]);
  const lines = () => readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines().length, 4);
  const resumed = openSession(project, home, true);
  assert.equal(resumed.file, file);
  assert.deepEqual(resumed.messages.map(m => m.role), ['user', 'assistant', 'tool', 'assistant']);

  if (process.argv[2] !== 'compact') {
    console.log('会话文件：~/.mox/sessions/<工作目录，/ 换成 ->/<创建时间>.jsonl\n');
    lines().forEach((line, i) => console.log(`${i + 1}  ${line.replace(/call_1_1/g, '<id>')}`));
    console.log(`\nopenSession(resume=true) 读回 ${resumed.messages.length} 条消息：${roles(resumed.messages)}`);

    await new Promise(r => setTimeout(r, 5));             // 文件名精确到毫秒
    const fresh = openSession(project, home);
    console.log(`openSession(resume=false) 得到 ${fresh.messages.length} 条消息，文件名不同：${fresh.file !== file}`);
    console.log(`此时会话目录里仍然只有 ${readdirSync(dir).length} 个文件：新文件要等第一条消息写入时才会出现`);
    assert.equal(readdirSync(dir).length, 1);
  } else {
    // 摘要替换掉“除最近 keep 条以外”的全部消息
    const summary = { role: 'user' as const, content: '（更早的对话已经压缩成下面的摘要）\n用户让 mox 读了 notes.txt。' };
    console.log(`压缩前，恢复出来的是：${roles(resumed.messages)}\n`);
    resumed.compacted(summary, 1);
    console.log(`追加一行：\n${lines().length}  ${lines().at(-1)}\n`);
    const after = openSession(project, home, true);
    console.log(`再次恢复：${roles(after.messages)}（摘要 + 最后 1 条）`);
    console.log(`文件有 ${lines().length} 行，前 4 行一个字都没有变`);
    assert.deepEqual(after.messages, [summary, resumed.messages.at(-1)]);
  }
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
}
