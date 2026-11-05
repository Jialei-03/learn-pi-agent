// 第 17 章：回放一次真实模型（MiniMax-M3.1-Flash）用 task 子 Agent 的运行。录制方法见 record.ts。
//   node labs/ch17/live.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rec = JSON.parse(readFileSync(new URL('./recorded/live-run.json', import.meta.url), 'utf8'));
console.log(`录制：${rec.recordedWith}（${rec.recordedAt}），用时 ${rec.seconds} 秒，退出码 ${rec.exitCode}`);
console.log(`$ ${rec.command}\n`);

// 终端输出：缩进的是子 Agent 的工具调用，不缩进的是主 Agent；最终回答很长，只显示开头
const lines: string[] = rec.output.split('\n');
const answerStart = lines.findIndex((l, i) => i > 0 && !l.startsWith(' ') && !l.startsWith('●') && !l.startsWith('  ✓') && l.trim() && lines.slice(0, i).some(x => x.startsWith('●')) && !lines.slice(i + 1).some(x => x.startsWith('●')));
const shown = [...lines.slice(0, answerStart + 6), '…（最终回答的其余部分省略）'];
console.log(shown.join('\n'));

const child = lines.filter(l => l.startsWith('    ●')).length;
const parentCalls = lines.filter(l => l.startsWith('●')).map(l => l.split(' ')[1]);
console.log(`\n子 Agent 在屏幕上留下了 ${child} 次工具调用；主 Agent 自己的工具调用：${parentCalls.join('、')}`);

console.log('\n主会话文件里实际保存的记录：\n');
console.log('| # | 角色 | 内容 | 字符数 |\n| --- | --- | --- | --- |');
rec.session.forEach((m: any, i: number) => {
  const what = m.toolCalls.length ? `调用 ${m.toolCalls.map((c: any) => `${c.name}(${c.arguments.slice(0, 50).replace(/\n/g, ' ')}…)`).join('、')}` : (m.content ?? '').split('\n').find((l: string) => l.trim())!.slice(0, 56);
  console.log(`| ${i + 1} | ${m.role} | ${what.replace(/\|/g, '/')} | ${m.chars} |`);
});
const total = rec.session.reduce((n: number, m: any) => n + m.chars, 0);
console.log(`\n子 Agent 的 ${child} 次工具调用里读到的内容，一个字符都没有进主会话；主会话从子 Agent 那里只收到第 3 条的 ${rec.session[2].chars} 个字符。`);

assert.equal(rec.exitCode, 0);
assert.deepEqual(rec.session.slice(0, 3).map((m: any) => m.role), ['user', 'assistant', 'tool']);
assert.equal(rec.session[1].toolCalls[0].name, 'task', '模型把调研交给了 task');
assert.ok(child >= 10, '子 Agent 做了很多次工具调用');
assert.ok(rec.session.slice(3).some((m: any) => m.toolCalls.length), '主 Agent 收到结论之后，又自己动手核实');
assert.ok(rec.session.slice(2).every((m: any) => !m.toolCalls.some((c: any) => c.name === 'task')), '后面没有再派子 Agent');
assert.ok(total < 12_000);
