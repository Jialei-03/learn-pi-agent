// 第 13 章实验：钩子自己出了问题，Agent 怎么办？
//   node labs/ch13/failures.ts
// 直接调用 extensions/hooks/protocol.ts，看每种情况下 PreToolUse 的裁决。
import { interpret, runHooks, type CommandHook } from '../../extensions/hooks/protocol.ts';

const cases: [string, CommandHook][] = [
  ['退出码 2', { type: 'command', command: 'echo "不允许" >&2; exit 2' }],
  ['退出码 1（脚本出错）', { type: 'command', command: 'echo "jq: command not found" >&2; exit 1' }],
  ['超时（timeout 1 秒，脚本要跑 3 秒）', { type: 'command', command: 'sleep 3', timeout: 1 }],
  ['stdout 不是合法 JSON', { type: 'command', command: `echo 'Welcome back!'; echo '{"hookSpecificOutput":{"permissionDecision":"deny"}}'` }],
  ['退出码 1，但配置了 onFailure: "block"', { type: 'command', command: 'exit 1', onFailure: 'block' }],
];

console.log('| 钩子的情况 | 工具调用 | 说明 |');
console.log('| --- | --- | --- |');
for (const [label, hook] of cases) {
  const runs = await runHooks({ PreToolUse: [{ matcher: 'Bash', hooks: [hook] }] }, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } }, { cwd: process.cwd(), projectDir: process.cwd(), toolName: 'Bash' });
  const v = interpret('PreToolUse', runs);
  console.log(`| ${label} | ${v.block ? '**被阻止**' : '照常执行'} | ${(v.block ?? v.notices[0] ?? '没有输出，视为同意').replace(/\n/g, ' ').replace(/\|/g, '\\|')} |`);
}

// 并行与去重：两个匹配项里写了同一条命令，只运行一次；不同的命令并行运行
const slow = (tag: string): CommandHook => ({ type: 'command', command: `sleep 1; echo ${tag} >> /dev/null` });
const start = Date.now();
const runs = await runHooks({ PreToolUse: [{ matcher: 'Bash', hooks: [slow('a'), slow('b')] }, { matcher: '*', hooks: [slow('a')] }] }, 'PreToolUse', { tool_name: 'Bash', tool_input: {} }, { cwd: process.cwd(), projectDir: process.cwd(), toolName: 'Bash' });
console.log(`\n三个配置项（其中两个是同一条命令），各需 1 秒：实际运行 ${runs.length} 个，总耗时 ${((Date.now() - start) / 1000).toFixed(1)} 秒`);
