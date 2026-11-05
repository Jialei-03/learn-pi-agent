// 回放第 5 章录制的真实运行：MiniMax-M3.1-Flash 通过 mox 命令行修一个 bug（录制方法见 record.ts）。
//   node labs/ch05/replay.ts
// 录制下来的是模型每一次回复。回放时把它们交给脚本模型，其余仍然是真的：
// mox 的 runLoop 和四个编程工具在一份全新的项目副本上重新执行，所以文件真的被改了，测试真的重新跑了。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scripted, type ScriptReply } from '../shared/scripted.ts';
import type { AssistantMsg } from '../../mox/src/model.ts';
import { file, freshProject, runTask } from './shared.ts';

const recording = JSON.parse(readFileSync(new URL('./recorded/fix-bug.json', import.meta.url), 'utf8'));
const dir = freshProject();
const replies = (recording.messages as { role: string }[]).filter((m): m is AssistantMsg => m.role === 'assistant');
const script: ScriptReply[] = replies.map(m => ({
  text: m.content || undefined,
  toolCalls: m.tool_calls?.map(c => ({ id: c.id, name: c.function.name, arguments: JSON.parse(c.function.arguments.replaceAll('<项目目录>', dir)) })),
}));

const model = scripted(script);
const { lines, answer } = await runTask(model, dir, recording.prompt);

console.log(`录制：${recording.model}，${recording.recordedAt}，用时 ${recording.seconds} 秒`);
console.log(`命令：${recording.command}\n`);
console.log(lines.join('\n'));
console.log(`\n${answer}\n`);

console.log('| 第几次请求 | 模型这一轮 | 工具调用 |');
console.log('| --- | --- | --- |');
replies.forEach((m, i) => {
  const calls = (m.tool_calls ?? []).map(c => c.function.name).join('、') || '（无，给出最终回答）';
  console.log(`| ${i + 1} | ${m.content ? m.content.split('\n')[0].slice(0, 40) : '（只调用工具）'} | ${calls} |`);
});

assert.equal(model.requests.length, replies.length);
assert.match(file(dir, 'calc.js'), /function add\(a, b\) \{\n  return a \+ b;/);
assert.match(file(dir, 'calc.js'), /function sub\(a, b\) \{\n  return a - b;/);
assert.ok(lines.some(l => l.endsWith('ok [退出码 0]')));
assert.ok(replies.some(m => (m.tool_calls?.length ?? 0) > 1));       // 真实模型会在一条回复里请求多个工具
