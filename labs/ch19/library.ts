// 第 19 章实验：mox 的“SDK”——不经过命令行，把它当库用。
//   node labs/ch19/library.ts
// 一个 CI 步骤：在临时项目里让 Agent 修好失败的测试，拿到事件流、最终回答和会话文件。
// 这就是 mox 全部的“SDK”：import 四个模块，自己装配。Pi 的 createAgentSession 装配的是同样的几样东西，只是每一样都有默认值。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { systemPrompt } from '../../mox/src/context.ts';
import { runLoop, type Event } from '../../mox/src/loop.ts';
import type { Msg } from '../../mox/src/model.ts';
import { openSession } from '../../mox/src/session.ts';
import { codingTools } from '../../mox/src/tools.ts';
import { scripted } from '../shared/scripted.ts';

const cwd = mkdtempSync(join(tmpdir(), 'ch19-lib-')), home = mkdtempSync(join(tmpdir(), 'ch19-home-'));
writeFileSync(join(cwd, 'add.js'), 'export const add = (a, b) => a - b;\n');

// ① 装配：模型、工具、会话、系统提示。换掉任何一样，都不影响其他三样
const model = scripted([
  { toolCalls: [{ name: 'edit', arguments: { path: 'add.js', edits: [{ oldText: 'a - b', newText: 'a + b' }] } }] },
  { text: '修好了：add.js 里的减号改成了加号。' },
]);
const tools = codingTools(cwd);
const session = openSession(cwd, home);
const system = systemPrompt(cwd, home, []);

// ② 运行：runLoop 就地往 session.messages 里追加，返回最后的回答；事件通过 onEvent 订阅
const events: string[] = [];
const onEvent = (e: Event) => {
  if (e.type === 'message') session.save(e.message);                       // 持久化是宿主的事，runLoop 只管循环
  events.push(e.type === 'tool_start' ? `tool_start(${e.call.function.name})` : e.type);
};
const prompt: Msg = { role: 'user', content: '修好 add 函数' };
session.messages.push(prompt);
session.save(prompt);
const answer = await runLoop(session.messages, { model, system, tools, onEvent, beforeTool: name => (name === 'bash' ? '这个宿主不允许执行命令' : undefined) });

// ③ 结果：最终回答、改动的文件、会话文件里的记录
console.log(`最终回答：${answer}`);
console.log(`add.js 现在是：${readFileSync(join(cwd, 'add.js'), 'utf8').trim()}`);
console.log(`事件（text 合并显示）：${events.filter((e, i) => !(e === 'text' && events[i - 1] === 'text')).join(' → ')}`);
console.log(`会话文件：${readFileSync(session.file, 'utf8').trim().split('\n').length} 行`);

// ④ 另一个宿主，另一天：同一个目录，打开最近的会话继续
const later = openSession(cwd, home, true);
console.log(`恢复会话：${later.messages.length} 条消息，角色依次是 ${later.messages.map(m => m.role).join(' → ')}`);

assert.equal(answer, '修好了：add.js 里的减号改成了加号。');
assert.match(readFileSync(join(cwd, 'add.js'), 'utf8'), /a \+ b/);
assert.equal(later.messages.length, session.messages.length);
assert.ok(events.includes('tool_start(edit)'));
