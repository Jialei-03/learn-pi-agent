// 第 6 章实验：提示缓存能复用多少？
//   node labs/ch06/cache.ts
// 服务商的提示缓存按“前缀”命中：这次请求的开头和上次完全相同的部分，可以按更低的价格计费、更快地处理。
// 这里模拟一次 6 轮的运行（每轮读一个文件），把每次请求序列化成 JSON，计算“与上一次请求相同的前缀”占多少
// （按字符，简化了服务商的实际规则）。四种让系统提示变化的方式：
//   A 系统提示末尾有一行精确到秒的当前时间
//   B 系统提示稳定，历史只在末尾追加
//   C 第 3 轮用户改了 AGENTS.md，Agent 重新生成了开头的系统提示
//   D 同样的修改，但开头不动，在历史末尾追加一条“项目说明已更新”
import assert from 'node:assert/strict';

type Message = { role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string };
const tools = [{ type: 'function', function: { name: 'read', description: '读取文件', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }];
const BASE = '你是一个编程助手。用工具读代码、改文件、运行命令来完成用户的任务。\n\n工作目录：/repo';
const agents = (v: string) => `项目说明，请遵守：\n<file path="/repo/AGENTS.md">\n${v}\n</file>`;
const OLD = '用 pnpm。', NEW = '用 pnpm，提交前跑测试。';

/** 第 n 轮之后的历史：每轮一次读文件、一段结果。 */
function history(turns: number): Message[] {
  const out: Message[] = [{ role: 'user', content: '帮我理解这个项目的结构。' }];
  for (let i = 1; i <= turns; i++) {
    out.push({ role: 'assistant', content: null, tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: `src/file${i}.ts` }) } }] });
    out.push({ role: 'tool', tool_call_id: `c${i}`, content: `// file${i}.ts\n` + 'export const x = 1;\n'.repeat(200) });
  }
  return out;
}

type Strategy = (turn: number) => { system: string; messages: Message[] };
const strategies: Record<string, Strategy> = {
  'A 系统提示里放了当前时间': turn => ({ system: `${BASE}\n\n${agents(OLD)}\n\n当前时间：2026-11-03 10:00:${String(turn * 7).padStart(2, '0')}`, messages: history(turn) }),
  'B 系统提示稳定，历史只追加': turn => ({ system: `${BASE}\n\n${agents(OLD)}`, messages: history(turn) }),
  'C 第 3 轮改了 AGENTS.md，重写开头': turn => ({ system: `${BASE}\n\n${agents(turn >= 3 ? NEW : OLD)}`, messages: history(turn) }),
  'D 第 3 轮改了 AGENTS.md，追加一条更新': turn => {
    const messages = history(turn);
    // 更新以一条新消息的形式插在第 3 轮的位置，之后一直留在历史里；开头的系统提示保持不变
    if (turn >= 3) messages.splice(1 + 2 * 2, 0, { role: 'user', content: `（项目说明已更新：${NEW}）` });
    return { system: `${BASE}\n\n${agents(OLD)}`, messages };
  },
};

const commonPrefix = (a: string, b: string) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };
console.log('| 策略 | 第 2 次 | 第 3 次 | 第 4 次 | 第 5 次 | 第 6 次 | 6 次合计 |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
const result: Record<string, { cells: number[]; total: number }> = {};
for (const [name, strategy] of Object.entries(strategies)) {
  let previous = '', reused = 0, total = 0;
  const cells: number[] = [];
  for (let turn = 1; turn <= 6; turn++) {
    const { system, messages } = strategy(turn);
    const body = JSON.stringify({ model: 'm', messages: [{ role: 'system', content: system }, ...messages], tools });
    const prefix = turn === 1 ? 0 : commonPrefix(previous, body);
    if (turn > 1) cells.push(Math.round((prefix / body.length) * 100));
    reused += prefix; total += body.length; previous = body;
  }
  result[name[0]] = { cells, total: Math.round((reused / total) * 100) };
  console.log(`| ${name} | ${cells.map(c => `${c}%`).join(' | ')} | ${result[name[0]].total}% |`);
}
assert.ok(result.A.cells.every(c => c < 5));                            // 时间在开头附近：每次几乎全部失效
assert.ok(result.B.cells.every((c, i, all) => c >= 50 && (i === 0 || c > all[i - 1])));   // 只追加：每次都命中，比例随轮数上升（新增内容占比越来越小）
assert.ok(result.C.cells[1] < 5);                                       // 第 3 轮重写开头：那一次几乎全部失效
assert.deepEqual([result.C.cells[0], ...result.C.cells.slice(2)], [result.B.cells[0], ...result.B.cells.slice(2)]);   // 其余各轮和 B 一样
assert.deepEqual(result.D.cells, result.B.cells);                       // 追加更新：和没改过一样
