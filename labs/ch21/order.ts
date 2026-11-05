// 第 21 章实验：两个扩展挂在同一个事件上，谁先加载，谁说了算？
//   node labs/ch21/order.ts
// mox 的事件有三种汇总方式：tool_call 走 verdict，每个扩展都被问到，拒绝优先；tool_result 走 transform，依次接力；
// agent_end 走 emit，按加载顺序，第一个给出结论（非空返回值）的说了算——后面的扩展这一轮根本没有机会开口。
import assert from 'node:assert/strict';
import { loadExtensions, type Extension } from '../../mox/src/extensions.ts';

const host = { cwd: process.cwd(), tools: [], ask: async () => undefined };

// ── ① tool_call：一个放行已知安全的命令，一个拦 rm ──
const allowEcho: Extension = mox => mox.on('tool_call', (name: string, args: any) => (name === 'bash' && /^(echo|ls)\b/.test(args.command) ? true : undefined));
const blockRm: Extension = mox => mox.on('tool_call', (name: string, args: any) => (name === 'bash' && /\brm\b/.test(args.command) ? '不允许删除文件' : undefined));
const verdict = (v: unknown) => (v === true ? '放行（不再问用户）' : typeof v === 'string' ? `拒绝：${v}` : '没有结论（交给内置的确认）');

console.log('① tool_call（verdict：拒绝优先）\n');
console.log('| 命令 | 先加载 allowEcho，再加载 blockRm | 先加载 blockRm，再加载 allowEcho |\n| --- | --- | --- |');
const verdicts: Record<string, string[]> = {};
for (const command of ['ls build', 'rm -rf build', 'echo hi && rm -rf build']) {
  const cells: string[] = [];
  for (const order of [[allowEcho, blockRm], [blockRm, allowEcho]]) {
    const loaded = await loadExtensions(order, host);
    cells.push(verdict(await loaded.verdict('bash', { command })));
  }
  verdicts[command] = cells;
  console.log(`| \`${command}\` | ${cells.join(' | ')} |`);
}
console.log('\n`echo hi && rm -rf build` 以 echo 开头，allowEcho 说“放行”，可是 blockRm 也被问到了，拒绝优先，两种加载顺序的结果一样。');

// ── ② tool_result：两个脱敏扩展，一个遮密钥，一个遮邮箱 ──
const redact = (pattern: RegExp): Extension => mox => mox.on('tool_result', (_name: string, _args: unknown, result: string) => (pattern.test(result) ? result.replace(pattern, '***') : undefined));
const maskKey = redact(/sk-\w+/g), maskMail = redact(/[\w.]+@[\w.]+/g);
const secret = 'key=sk-abc123 user=ann@example.com';

console.log('\n② tool_result（transform：接力，后一个拿到前一个改过的结果）\n');
console.log(`工具的原始输出：${secret}\n`);
console.log('| 加载顺序 | 模型看到的 |\n| --- | --- |');
const results: string[] = [];
for (const [name, order] of [['先遮密钥，再遮邮箱', [maskKey, maskMail]], ['先遮邮箱，再遮密钥', [maskMail, maskKey]]] as const) {
  const loaded = await loadExtensions([...order], host);
  const seen = await loaded.transform('bash', {}, secret);
  results.push(seen);
  console.log(`| ${name} | \`${seen}\` |`);
}

// ── ③ agent_end：两个扩展都想让 Agent 接着干 ──
// 目标循环说“检查没过，继续”，后台命令说“构建结束了，继续”。emit 只取第一个，后面的处理函数这一轮根本不会被调用。
const called: string[] = [];
const wants = (name: string, text: string): Extension => mox => mox.on('agent_end', () => { called.push(name); return text; });
console.log('\n③ agent_end（emit：第一个给出结论的说了算）\n');
console.log('| 加载顺序 | 这一轮 Agent 收到的下一句话 | 被调用过的处理函数 |\n| --- | --- | --- |');
const next: { text: string; called: string[] }[] = [];
for (const [name, order] of [['目标 → 后台', [wants('目标', '检查没过，继续'), wants('后台', '构建结束了')]], ['后台 → 目标', [wants('后台', '构建结束了'), wants('目标', '检查没过，继续')]]] as const) {
  called.length = 0;
  const loaded = await loadExtensions([...order], host);
  const text = loaded.text(await loaded.emit('agent_end', '完成了'))!;
  next.push({ text, called: [...called] });
  console.log(`| ${name} | ${text} | ${called.join('、')} |`);
}
console.log('\n另一个扩展的话这一轮听不到：它的处理函数没有被调用，状态也没有变化，要等下一次 Agent 停下才有机会。');
console.log('如果排在前面的处理函数要 await 很久（比如后台命令的等待），后面的检查就一直等着。');

assert.deepEqual(verdicts['ls build'], ['放行（不再问用户）', '放行（不再问用户）']);
assert.deepEqual(verdicts['rm -rf build'], ['拒绝：不允许删除文件', '拒绝：不允许删除文件']);
assert.deepEqual(verdicts['echo hi && rm -rf build'], ['拒绝：不允许删除文件', '拒绝：不允许删除文件'], '拒绝优先：安全不取决于加载顺序');
assert.deepEqual(results, ['key=*** user=***', 'key=*** user=***'], 'tool_result 接力：两个脱敏都生效，与顺序无关');
assert.deepEqual(next, [{ text: '检查没过，继续', called: ['目标'] }, { text: '构建结束了', called: ['后台'] }], 'agent_end：第一个说了算，后面的处理函数没有被调用');
