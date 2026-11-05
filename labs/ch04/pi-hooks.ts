// 第 4 章实验：Pi 的执行前拦截和执行后改写。
//   node labs/ch04/pi-hooks.ts
// beforeToolCall：拦下会删除根目录的命令，工具函数根本不会被调用，结果带 isError。
// afterToolCall：把命令输出里的密钥隐去，模型永远看不到原文。
// 第三条命令换了个写法（find / -delete），正则拦不住。
import assert from 'node:assert/strict';
import { runPi, type RunTool } from '../shared/harness.ts';
import type { Script } from '../shared/scripted.ts';

const executed: string[] = [];
const bash: RunTool = {
  name: 'bash', description: '执行 shell 命令', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
  run({ command }) {
    executed.push(command);                       // 假的 shell：只记录，不真正执行
    if (command === 'cat .env') return 'DATABASE_URL=postgres://localhost/mox\nOPENAI_API_KEY=sk-live-9f8e7d6c5b4a3210';
    return '（执行完成）';
  },
};
const beforeTool = (name: string, args: any) =>
  name === 'bash' && /\brm\s+-rf\s+\/(\s|$)/.test(String(args.command)) ? '拒绝执行：这条命令会删除根目录。请只删除项目内的目录。' : undefined;
const afterTool = (_name: string, _args: unknown, result: string) => {
  const redacted = result.replace(/sk-[A-Za-z0-9-]{8,}/g, 'sk-***');
  return redacted !== result ? redacted : undefined;
};

const commands = ['rm -rf build && rm -rf /', 'cat .env', 'find / -delete'];
const script: Script = (_messages, n) => (n <= commands.length ? { toolCalls: [{ name: 'bash', arguments: { command: commands[n - 1] } }] } : { text: '处理完了。' });

const report = await runPi({ prompt: '清理一下并看看配置', script, tools: [bash], beforeTool, afterTool });
report.results.forEach((r, i) => console.log(`第 ${i + 1} 条 ${commands[i].padEnd(26)} 模型看到：${r.content.replace(/\n/g, ' ⏎ ')}（${r.isError ? '错误' : '正常'}）`));
console.log(`真正执行过的命令：${executed.join('；') || '（无）'}`);

assert.deepEqual(executed, ['cat .env', 'find / -delete']);           // 第一条没有到达工具；换个写法的第三条到达了
assert.ok(report.results[0].isError && report.results[1].content.includes('sk-***') && !report.results[1].content.includes('9f8e'));
