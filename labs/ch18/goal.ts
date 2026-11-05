// 第 18 章实验：mox 的目标循环。模型说“修好了”不算数，node test.js 通过才算。
//   node labs/ch18/goal.ts
// 跑的是真正的 mox 命令行：MOX_GOAL="node test.js" mox -p "修好 add 函数" -e extensions/goal/mox.ts。
// cli.ts 的 run 里有一个 while 循环：Agent 停下时问扩展“还要不要继续”，扩展返回一句话，它就把这句话当作新的用户消息再跑一轮。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadExtensions } from '../../mox/src/extensions.ts';
import { runMox, type CliScript } from '../shared/mox-cli.ts';
import { createGoalMoxExtension } from '../../extensions/goal/mox.ts';

const extension = fileURLToPath(new URL('../../extensions/goal/mox.ts', import.meta.url));
const temp = (name: string) => mkdtempSync(join(tmpdir(), `ch18-${name}-`));

function project() {
  const cwd = temp('goal');
  mkdirSync(join(cwd, 'src'));
  writeFileSync(join(cwd, 'package.json'), '{"type":"module"}');
  writeFileSync(join(cwd, 'src', 'add.js'), 'export const add = (a, b) => a - b;\n');
  writeFileSync(join(cwd, 'test.js'), "import { add } from './src/add.js';\nif (add(2, 3) !== 5) { console.error(`FAIL add(2, 3) = ${add(2, 3)}，期望 5`); process.exit(1); }\nconsole.log('PASS');\n");
  return cwd;
}

async function scenario(title: string, script: CliScript) {
  let last: ReturnType<CliScript> | undefined;
  const recording: CliScript = (request, n) => (last = script(request, n));
  const run = await runMox(['-p', '修好 add 函数', '--yolo', '-e', extension], { cwd: project(), home: temp('home'), script: recording, env: { MOX_GOAL: 'node test.js' } });
  console.log(`━━ ${title} ━━`);
  // 模型最后一次请求看到的完整对话，就是这次运行的全过程
  for (const m of run.requests.at(-1)!.messages.slice(1)) {
    if (m.role === 'user') console.log(`用户：${String(m.content).split('\n').slice(0, 2).join(' / ').slice(0, 90)}`);
    if (m.role === 'assistant') console.log(`模型：${m.content ?? ''}${(m.tool_calls ?? []).map((c: any) => `→ ${c.function.name}`).join('')}`);
    if (m.role === 'tool') console.log(`  ✓ ${String(m.content).trim().slice(0, 60)}`);
  }
  console.log(`模型：${last?.text ?? ''}`);
  const notice = run.output.split('\n').find(l => /^目标(达成|循环停止)/.test(l)) ?? '';
  console.log(`结果：${notice}\n`);
  return { run, notice, messages: run.requests.at(-1)!.messages as any[] };
}

const fix = { name: 'edit', arguments: { path: 'src/add.js', edits: [{ oldText: 'a - b', newText: 'a + b' }] } };
const hasEdit = (messages: any[]) => messages.some(m => m.role === 'assistant' && m.tool_calls?.some((c: any) => c.function.name === 'edit'));
const hasGoalMessage = (messages: any[]) => messages.some(m => m.role === 'user' && String(m.content).startsWith('目标还没有达成'));

// ① 模型先是只嘴上说修好了；检查失败的输出交回它，第二轮才真的改
const fixed = await scenario('模型先是只嘴上说修好了', ({ messages }, n) => {
  if (n === 1) return { text: '已经修好了。' };
  if (n === 2) return hasGoalMessage(messages) ? { toolCalls: [fix] } : { text: '（不会走到这里）' };
  return { text: '这次真的修好了：减号改成了加号。' };
});
// ② 模型一直声称修好了，却什么都不改
const stuck = await scenario('模型一直不改文件', (_r, n) => ({ text: ['已经修好了。', '我确认已经修好了。', '确实修好了。'][n - 1] ?? '修好了。' }));

// ③ /goal 命令：交互模式里设定目标用的就是它（mox -p 没有命令，所以上面用了环境变量）
const host = { cwd: project(), tools: [], ask: async () => undefined };
const loaded = await loadExtensions([createGoalMoxExtension({ maxRounds: 2, check: undefined })], host);
const written: string[] = [];
const write = process.stdout.write.bind(process.stdout);
process.stdout.write = ((chunk: string) => { written.push(String(chunk).trim()); return true; }) as typeof process.stdout.write;
await loaded.commands.get('goal')!('"node test.js" 修好 add');
const next = loaded.text(await loaded.emit('agent_end', '已经修好了'));
process.stdout.write = write;
console.log(`/goal "node test.js" 修好 add → 输出“${written[0]}”`);
console.log(`Agent 说“已经修好了”准备停下，agent_end 返回的下一句话：\n  ${next?.split('\n').slice(0, 3).join('\n  ')}`);

assert.ok(fixed.messages.some(m => m.role === 'user' && String(m.content).includes('add(2, 3) = -1，期望 5')), '检查失败时，测试的输出要交回给模型');
assert.ok(hasEdit(fixed.messages));
assert.match(fixed.notice, /目标达成/);
assert.equal(fixed.run.requests.length, 3);
assert.ok(!hasEdit(stuck.messages));
assert.equal(stuck.run.requests.length, 2, '第二轮就被拦下：模型只回复了两次，没有等到轮数上限');
assert.match(stuck.notice, /原地打转/);
assert.match(written[0], /目标已设定：node test.js/);
assert.match(next ?? '', /目标还没有达成（第 1\/2 轮）/);
