// 第 4 章实战检验：mox 的 Tool、execute 和 beforeTool / afterTool 写对了吗？
//   node labs/ch04/practice.ts                 检验参考实现 mox/
//   MOX_DIR=~/my-mox node labs/ch04/practice.ts  检验你自己写的
// 用脚本模型驱动你的 runLoop（只需要 mox/src/loop.ts），逐项检查一次工具调用要过的几关，打印模型在每种情况下看到了什么。
import assert from 'node:assert/strict';
import { loadMox, whose } from '../shared/mox-dir.ts';
import { scripted, type ScriptReply } from '../shared/scripted.ts';

const { runLoop } = await loadMox('loop.ts');
console.log(`${whose()}\n`);

const calls: string[] = [];
const tools = [
  { name: 'echo', description: '原样返回', parameters: { type: 'object', properties: { text: { type: 'string' } } }, run: ({ text }: any) => { calls.push(`echo:${text}`); return `echo ${text}`; } },
  { name: 'boom', description: '总是失败', parameters: { type: 'object', properties: {} }, run: () => { calls.push('boom'); throw new Error('出错了'); } },
];

/** 让脚本模型第一次回复里发出这些调用，第二次回复收尾；返回模型第二次请求时看到的 tool 消息和事件。 */
async function scenario(first: ScriptReply, options: Record<string, unknown> = {}, rawArguments?: string) {
  calls.length = 0;
  const inner = scripted([first, { text: '好了。' }]);
  // rawArguments：想构造“不是合法 JSON”的参数，只能在模型这一层改
  const model = rawArguments === undefined ? inner : async (request: any) => {
    const reply = await inner(request);
    if (reply.message.tool_calls) reply.message.tool_calls[0].function.arguments = rawArguments;
    return reply;
  };
  const events: { name: string; result: string; error: boolean }[] = [];
  const messages: any[] = [{ role: 'user', content: '开始' }];
  await runLoop(messages, { model, system: '', tools, onEvent: (e: any) => { if (e.type === 'tool_end') events.push({ name: e.call.function.name, result: e.result, error: e.error }); }, ...options });
  return { messages, results: messages.filter(m => m.role === 'tool').map(m => m.content as string), events };
}

const rows: [string, string, string][] = [];
const check = (name: string, seen: string, ok: boolean) => { rows.push([ok ? '✓' : '✗', name, seen.replace(/\n/g, ' ⏎ ')]); assert.ok(ok, `${name}：${seen}`); };

let r = await scenario({ toolCalls: [{ name: 'echo', arguments: { text: 'hi' } }] });
check('正常调用：run 的返回值就是工具结果', r.results[0], r.results[0] === 'echo hi' && r.events[0].error === false);

r = await scenario({ toolCalls: [{ name: 'nope', arguments: {} }] });
check('工具不存在：错误结果，不抛出', r.results[0], r.results[0].startsWith('错误') && r.events[0].error);

r = await scenario({ toolCalls: [{ name: 'echo', arguments: {} }] }, {}, '{"text": ');
check('参数不是合法 JSON：错误结果，工具没有被调用', r.results[0], r.results[0].startsWith('错误') && calls.length === 0);

r = await scenario({ toolCalls: [{ name: 'boom', arguments: {} }] });
check('run 抛异常：异常信息交给模型', r.results[0], r.results[0].startsWith('错误') && r.results[0].includes('出错了') && r.events[0].error);

r = await scenario({ toolCalls: [{ name: 'echo', arguments: { text: 'rm' } }] }, { beforeTool: (_n: string, a: any) => (a.text === 'rm' ? '不允许 rm' : undefined) });
check('beforeTool 返回字符串：拒绝，理由交给模型，run 没有被调用', r.results[0], r.results[0].includes('不允许 rm') && calls.length === 0 && r.events[0].error);

r = await scenario({ toolCalls: [{ name: 'echo', arguments: { text: 'sk-secret' } }] }, { afterTool: (_n: string, _a: unknown, result: string) => result.replace('sk-secret', '***') });
check('afterTool 返回字符串：替换结果', r.results[0], r.results[0] === 'echo ***');

let afterCalled = false;
r = await scenario({ toolCalls: [{ name: 'boom', arguments: {} }] }, { afterTool: () => { afterCalled = true; return '不该看到'; } });
check('失败的调用不经过 afterTool', r.results[0], !afterCalled && r.results[0].startsWith('错误'));

r = await scenario({ toolCalls: [{ name: 'echo', arguments: { text: '1' } }, { name: 'boom', arguments: {} }, { name: 'echo', arguments: { text: '3' } }] });
check('三个调用，中间一个失败：每个调用都有结果，顺序不变，后面的照常执行', r.results.join(' / '), r.results.length === 3 && r.results[0] === 'echo 1' && r.results[1].startsWith('错误') && r.results[2] === 'echo 3');
const ids = r.messages.filter(m => m.role === 'assistant')[0].tool_calls.map((c: any) => c.id);
assert.deepEqual(r.messages.filter(m => m.role === 'tool').map(m => m.tool_call_id), ids);   // 结果的 tool_call_id 与调用一一对应

console.log('| | 检查项 | 模型看到的 |');
console.log('| --- | --- | --- |');
for (const row of rows) console.log(`| ${row.join(' | ')} |`);
