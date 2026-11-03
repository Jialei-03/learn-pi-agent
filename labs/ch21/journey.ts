// 第 21 章实验：一次请求的完整旅程。把前面各章的部件同时装进 mox，跟着一个任务走一遍，看每一步是哪一章的机制在起作用。
//   node labs/ch21/journey.ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createCheckpointMoxExtension } from '../../extensions/checkpoint/mox.ts';
import { createGoalMoxExtension } from '../../extensions/goal/mox.ts';
import { createHooksMoxExtension } from '../../extensions/hooks/mox.ts';
import { createMemoryMoxExtension } from '../../extensions/memory/mox.ts';
import { createPermissionsMoxExtension } from '../../extensions/permissions/mox.ts';
import { createSandboxMoxExtension } from '../../extensions/sandbox/mox.ts';
import { detectSandbox } from '../../extensions/sandbox/policy.ts';
import { createCodingTools } from '../../mox/src/coding/index.ts';
import { buildSystemPrompt } from '../../mox/src/context.ts';
import { ExtensionHost } from '../../mox/src/extensions.ts';
import { runLoop } from '../../mox/src/loop.ts';
import { scripted } from '../../mox/src/providers/scripted.ts';
import { formatSkillsIndex, loadSkills } from '../../mox/src/skills.ts';
import { BUILTIN_AGENTS, createAgentTool } from '../../mox/src/subagent.ts';
import type { Message } from '../../mox/src/types.ts';
import { hooksConfig } from '../ch13/fixture.ts';

// ── 现场：一个有 bug 的小项目 ──
const root = mkdtempSync(join(tmpdir(), 'ch21-'));
const cwd = join(root, 'project');
mkdirSync(join(cwd, 'src'), { recursive: true });
writeFileSync(join(cwd, 'package.json'), '{"type":"module"}');
writeFileSync(join(cwd, 'src', 'add.js'), 'export const add = (a, b) => a - b;\n');
writeFileSync(join(cwd, 'test.js'), "import { add } from './src/add.js';\nif (add(2, 3) !== 5) { console.error('FAIL'); process.exit(1); }\nconsole.log('PASS');\n");
writeFileSync(join(cwd, '.env'), 'TOKEN=secret\n');
execSync('git init -q && git add -A && git -c user.email=a@b -c user.name=a commit -qm init', { cwd });
mkdirSync(join(root, 'skills', 'testing'), { recursive: true });
writeFileSync(join(root, 'skills', 'testing', 'SKILL.md'), '---\nname: testing\ndescription: 运行和修复这个项目的测试。改动代码后使用。\n---\n用 node test.js 运行测试。\n');
// save_memory 放进 allow：记忆扩展有自己的审核规则（第 10 章），不需要权限扩展再问一遍——两个扩展管同一件事时，要明确由谁负责
writeFileSync(join(root, 'permissions.json'), JSON.stringify({ permissions: { deny: ['Read(.env)'], allow: ['Bash(node *)', 'save_memory'] } }));
writeFileSync(join(root, 'hooks.json'), JSON.stringify(hooksConfig));

const trace: string[] = [];
const note = (chapter: string, text: string) => trace.push(`${chapter.padEnd(7)} ${text}`);
// 目标扩展直接往终端打印，这里把它收进追踪记录里
const write = process.stdout.write.bind(process.stdout);
process.stdout.write = ((chunk: string) => { for (const l of String(chunk).split('\n').filter(x => x.trim())) note('第18章', l.trim()); return true; }) as typeof process.stdout.write;

// ── 组装：和 mox/src/cli.ts 的 main 做的事一样 ──
const codingTools = createCodingTools(cwd);
const host = new ExtensionHost(cwd, codingTools.map(t => t.name));
await host.load('hooks', createHooksMoxExtension([join(root, 'hooks.json')], t => note('第13章', `钩子：${t}`)));
await host.load('permissions', createPermissionsMoxExtension([{ path: join(root, 'permissions.json'), base: cwd }], 'acceptEdits'));
await host.load('memory', createMemoryMoxExtension({ dir: join(root, 'memory') }));
await host.load('checkpoint', createCheckpointMoxExtension(join(root, 'shadow.git')));
await host.load('goal', createGoalMoxExtension(3));
const sandboxed = !!detectSandbox();
await host.load('sandbox', createSandboxMoxExtension());           // 最后加载：权限和钩子看到的是改写之前的命令
await host.notify('session_start', { cwd });
note('第9章', `加载了 ${6} 个扩展：hooks、permissions、memory、checkpoint、goal、sandbox${sandboxed ? '' : '（这台机器没有沙箱，bash 不受限）'}`);

const { skills } = loadSkills([join(root, 'skills')]);
// 父 Agent 和子 Agent 共用一个脚本模型：按系统提示区分是谁在请求
let parentStep = 0, childStep = 0;
const model = scripted(c => {
  if (c.systemPrompt.includes('负责调研的子 Agent')) {
    return ++childStep === 1 ? { toolCalls: [{ id: 'c1', name: 'read', arguments: { path: 'src/add.js' } }] } : { text: 'add 在 src/add.js 第 1 行，用的是减号。' };
  }
  const steps = [
    { toolCalls: [{ id: 'p1', name: 'agent', arguments: { agent: 'explore', task: '找到 add 函数的定义，说明它哪里错了。' } }] },
    { toolCalls: [{ id: 'p2', name: 'edit', arguments: { path: 'src/add.js', edits: [{ oldText: 'a - b', newText: 'a + b' }] } }] },
    { toolCalls: [{ id: 'p3', name: 'bash', arguments: { command: 'rm -rf build' } }] },
    { toolCalls: [{ id: 'p4', name: 'read', arguments: { path: '.env' } }] },
    { toolCalls: [{ id: 'p5', name: 'bash', arguments: { command: 'node test.js' } }] },
    { toolCalls: [{ id: 'p6', name: 'save_memory', arguments: { name: 'test-command', description: '测试命令', type: 'project', content: '这个项目用 node test.js 运行测试。' } }] },
    { text: '修好了：减号改成加号，测试通过。' },
  ];
  return steps[parentStep++] ?? { text: '完成。' };
});
const agentTool = createAgentTool({ model, tools: () => [...codingTools, ...host.tools], hooks: host.toolHooks(), agents: BUILTIN_AGENTS, cwd });
const tools = [...codingTools, agentTool, ...host.tools];
const base = await buildSystemPrompt({ cwd, tools, skillsIndex: formatSkillsIndex(skills) });

// ── 用户输入 ──
// 第 18 章：设定目标（mox 的命令由 CLI 分发，这里直接调用）
await host.commands.get('goal')!.handler('"node test.js" 修好 add', { cwd });
const prompt = '修好 add 函数，记住这个项目的测试命令';
const input = await host.emitInput(prompt);                          // 第 13 章 UserPromptSubmit、第 16 章拍快照
note('第16章', '检查点：用户提问之前给工作目录拍了快照');
const systemPrompt = await host.emitBeforeAgentStart(input.text, base);   // 第 10 章记忆、第 13 章 SessionStart 的信息加入系统提示
note('第6章', `系统提示 ${systemPrompt.length} 个字符：项目信息、工具说明、Skills 目录（第11章）、记忆（第10章）、钩子补充的项目信息（第13章）`);

const history: Message[] = [];
const { reason } = await runLoop([], [{ role: 'user', content: input.text }], {
  model, systemPrompt, tools, hooks: host.toolHooks(),
  getFollowUp: async () => { const t = await host.emitBeforeSettle(history); if (t) note('第18章', `目标没达成，再来一轮`); return t ? [{ role: 'user', content: t }] : []; },
  onEvent: e => {
    if (e.type === 'message') history.push(e.message);
    if (e.type === 'turn_start') note('第3章', `第 ${e.turn} 轮：请求模型（发送前修复历史，第7章）`);
    if (e.type === 'tool_start') note('第4章', `工具调用 ${e.toolCall.name} ${JSON.stringify(e.toolCall.arguments).slice(0, 60)}`);
    if (e.type === 'tool_end') {
      const c = e.result.content;
      const by = c.startsWith('权限：') ? '第14章' : c.includes('禁止执行破坏性命令') || c.includes('.env 里是密钥') ? '第13章' : e.result.toolName === 'agent' ? '第17章' : e.result.toolName === 'save_memory' ? '第10章' : e.result.toolName === 'bash' && sandboxed ? '第15章' : '第5章';
      const what = by === '第15章' ? `在沙箱里执行：${c.trim()}` : c.replace(/\s+/g, ' ').slice(0, 70);
      note(by, `${e.result.isError ? '✗' : '✓'} ${what}`);
    }
  },
});
await host.notify('agent_end', { reason });
await host.notify('session_shutdown', {});
process.stdout.write = write;
console.log(trace.join('\n'));
