// mox 命令行（第 5 章起）。把前几章的零件装在一起：适配器 + 循环 + 工具流水线 + 四个 coding 工具。
//
//   node mox/src/cli.ts                 交互模式（新会话）
//   node mox/src/cli.ts --continue      继续当前目录最近一次会话（第 7 章）
//   node mox/src/cli.ts --session F     打开指定的会话文件
//   node mox/src/cli.ts -p "修复测试"    一次性执行，打印最终回答
//
// 交互命令（第 7 章）：/tree 查看会话树，/branch <id> 回到某条记录开新分支，/new 新会话
// 第 8 章：上下文超过 MOX_CONTEXT_WINDOW（默认 128000）减去预留时自动压缩；/compact [要求] 手动压缩
// 第 9 章：从 ~/.mox/extensions 加载扩展；项目里的 .mox/extensions 只有加上 --trust 才加载；--ext 文件 直接加载一个扩展
// 第 11 章：Skills（~/.mox/skills、~/.agents/skills、项目的 .agents/skills）与提示模板（~/.mox/prompts）；/skill:名字 强制使用
// 第 12 章：MCP 服务器（~/.mox/mcp.json；项目的 .mox/mcp.json 需要 --trust），工具名为 mcp__服务器__工具
// 第 17 章：agent 工具把子任务交给子 Agent（内置 explore、general；自定义的放在 ~/.mox/agents/*.md）
// 第 18 章：--continue 打开的会话如果上次没跑完（崩溃、被杀），先补上中断的工具结果，再从断点继续
// 第 19 章：--mode json -p "任务" 输出 JSON 事件流；--mode rpc 长期运行，用 JSON 命令控制；--no-session 不保存会话
//           MOX_API=scripted MOX_SCRIPT=脚本.ts 使用脚本模型（测试和实验用）
//
// 环境变量：
//   MOX_API=openai|anthropic（默认 openai，任何 OpenAI 兼容服务都走这一路）
//   MOX_BASE_URL、MOX_API_KEY、MOX_MODEL
//
// 运行中可以直接输入文字：它会作为“插话”在下一轮交给模型（第 3 章）。Ctrl+C 取消当前运行，再按一次退出。
import { createInterface } from 'node:readline';
import { runLoop } from './loop.ts';
import { anthropic } from './providers/anthropic.ts';
import { openai } from './providers/openai.ts';
import { createCodingTools } from './coding/index.ts';
import { buildSystemPrompt, estimateContextTokens } from './context.ts';
import { compactSession, shouldCompact } from './compaction.ts';
import { Session } from './session.ts';
import { ExtensionHost } from './extensions.ts';
import { expandSkillCommand, expandTemplate, formatSkillsIndex, loadSkills, loadTemplates } from './skills.ts';
import { createMcpExtension, loadMcpConfig } from './mcp/index.ts';
import { BUILTIN_AGENTS, createAgentTool, loadAgents } from './subagent.ts';
import { findInterrupted, INTERRUPTED, needsResume, settleInterrupted } from './resume.ts';
import { startRpc, toWireEvent } from './rpc.ts';
import { scripted } from './providers/scripted.ts';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Model, UserMessage } from './types.ts';

const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
const orange = (s: string) => `\x1b[38;5;208m${s}\x1b[39m`;
const red = (s: string) => `\x1b[31m${s}\x1b[39m`;

export function modelFromEnv(env = process.env): Model {
  const apiKey = env.MOX_API_KEY;
  if (!apiKey) throw new Error('请先设置 MOX_API_KEY（以及 MOX_BASE_URL、MOX_MODEL）。没有 Key 时可以运行 labs/ 下的离线实验。');
  return env.MOX_API === 'anthropic'
    ? anthropic({ apiKey, model: env.MOX_MODEL ?? 'claude-sonnet-4-5', baseUrl: env.MOX_BASE_URL })
    : openai({ apiKey, model: env.MOX_MODEL ?? 'gpt-4o-mini', baseUrl: env.MOX_BASE_URL });
}

const preview = (text: string, n = 160) => {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n) + '…' : one;
};

/** 测试替身：MOX_SCRIPT 指向一个模块，它默认导出一个第 2 章的脚本函数 */
async function scriptedFromEnv(env = process.env): Promise<Model> {
  if (!env.MOX_SCRIPT) throw new Error('MOX_API=scripted 需要 MOX_SCRIPT 指向脚本模块');
  return scripted((await import(pathToFileURL(resolve(env.MOX_SCRIPT)).href)).default);
}

export async function main(argv = process.argv.slice(2)) {
  const cwd = process.cwd();
  const model = process.env.MOX_API === 'scripted' ? await scriptedFromEnv() : modelFromEnv();
  // 第 19 章：json / rpc 模式下 stdout 只放协议记录，给人看的信息一律走 stderr
  const mode = argv.includes('--mode') ? argv[argv.indexOf('--mode') + 1] : 'interactive';
  const machine = mode === 'json' || mode === 'rpc';
  const say = (text: string) => (machine ? process.stderr : process.stdout).write(text);
  const emitJson = (record: object) => process.stdout.write(`${JSON.stringify(record)}\n`);
  // 扩展：用户全局的总是加载；项目里的扩展是可执行代码，必须显式信任（第 9 章）
  const trusted = argv.includes('--trust');
  const codingTools = createCodingTools(cwd);
  const host = new ExtensionHost(cwd, codingTools.map(t => t.name));
  await host.loadDirectory(join(homedir(), '.mox', 'extensions'));
  if (trusted) await host.loadDirectory(join(cwd, '.mox', 'extensions'));
  // --ext 路径：直接加载一个扩展文件（比如本仓库的 extensions/permissions/mox.ts），可以写多次
  for (let i = argv.indexOf('--ext'); i !== -1; i = argv.indexOf('--ext', i + 1)) {
    const file = resolve(argv[i + 1]);
    await host.load(file, (await import(pathToFileURL(file).href)).default);
  }
  // MCP 服务器（第 12 章）：作为内置扩展加载。项目里的 .mox/mcp.json 会启动任意命令，同样需要 --trust
  const mcp = loadMcpConfig([join(homedir(), '.mox', 'mcp.json'), ...(trusted ? [join(cwd, '.mox', 'mcp.json')] : [])]);
  for (const error of mcp.errors) process.stderr.write(dim(`[mcp] ${error}\n`));
  if (mcp.servers.length) await host.load('mcp', createMcpExtension(mcp.servers, { onStatus: m => process.stderr.write(dim(`${m}\n`)) }));
  await host.notify('session_start', { cwd });
  // 子 Agent（第 17 章）：内置 explore、general，加上 ~/.mox/agents（项目里的 .mox/agents 需要 --trust）。
  // 子 Agent 的工具调用经过同一组钩子：权限规则对它同样有效
  const agents = [...BUILTIN_AGENTS, ...loadAgents([join(homedir(), '.mox', 'agents'), ...(trusted ? [join(cwd, '.mox', 'agents')] : [])])];
  const agentTool = createAgentTool({ model, tools: () => allTools(), hooks: host.toolHooks(), agents, cwd });
  // 每次运行都重新取一次：MCP 服务器的工具列表可能在会话中途变化
  const allTools = () => [...codingTools, agentTool, ...host.tools];
  const tools = allTools();
  // #region skills
  // Skills 和模板也可能指示模型执行脚本，项目里的同样需要 --trust（第 11 章）
  const { skills, diagnostics } = loadSkills([join(homedir(), '.mox', 'skills'), join(homedir(), '.agents', 'skills'), ...(trusted ? [join(cwd, '.agents', 'skills'), join(cwd, '.mox', 'skills')] : [])]);
  for (const d of diagnostics) process.stderr.write(`\x1b[2m[skill] ${d.file}：${d.message}\x1b[22m\n`);
  const templates = [...loadTemplates(join(homedir(), '.mox', 'prompts')), ...(trusted ? loadTemplates(join(cwd, '.mox', 'prompts')) : [])];
  const systemPrompt = await buildSystemPrompt({ cwd, tools, skillsIndex: formatSkillsIndex(skills) || undefined });
  // #endregion
  const sessionFlag = argv.indexOf('--session');
  let session = argv.includes('--no-session') ? Session.create(cwd, '')
    : argv.includes('--continue') ? Session.continueRecent(cwd)
    : sessionFlag !== -1 ? Session.open(argv[sessionFlag + 1])
    : Session.create(cwd);
  const steering: UserMessage[] = [];
  let controller: AbortController | undefined;

  const contextWindow = Number(process.env.MOX_CONTEXT_WINDOW ?? 128000);
  /** 上下文快满时压缩，返回压缩后的上下文；没有压缩则返回 undefined。 */
  async function maybeCompact(force = false, instructions?: string) {
    const { tokens } = estimateContextTokens(systemPrompt, session.messages());
    if (!force && !shouldCompact(tokens, contextWindow)) return undefined;
    process.stdout.write(dim(`\n（上下文约 ${tokens} tokens，正在压缩……）\n`));
    const result = await compactSession(session, model, { instructions, signal: controller?.signal });
    process.stdout.write(dim(`（已把 ${result.summarized} 条消息压缩成摘要，保留最近 ${result.kept} 条）\n`));
    return session.messages();
  }

  async function run(input: string) {
    const { text: raw, handled } = await host.emitInput(input);          // 扩展可以改写或接管输入
    if (handled) return;
    // #region expand
    const prompt = expandTemplate(expandSkillCommand(raw, skills), templates); // 第 11 章：/skill:名字 与 /模板
    // #endregion
    await execute(prompt);
  }

  /** 跑一次 Agent 循环。prompt 为空表示不加新消息，从会话现在的状态继续（第 18 章：崩溃后恢复） */
  async function execute(prompt: string) {
    await maybeCompact();
    controller = new AbortController();
    const runPrompt = await host.emitBeforeAgentStart(prompt, systemPrompt);
    const { messages, reason } = await runLoop(session.messages(), prompt ? [{ role: 'user', content: prompt }] : [], {
      model, systemPrompt: runPrompt, tools: allTools(), signal: controller.signal, hooks: host.toolHooks(),
      getSteering: () => steering.splice(0),
      // 准备停下时问一下扩展：要不要再跑一轮（第 13 章 Stop 钩子）
      getFollowUp: async () => { const text = await host.emitBeforeSettle(session.messages()); return text ? [{ role: 'user' as const, content: text }] : []; },
      prepareNextTurn: () => maybeCompact(),
      onEvent: e => {
        if (e.type === 'message') session.appendMessage(e.message);       // 每条消息一形成就写进会话（第 7 章）
        if (machine) { const wire = toWireEvent(e); if (wire) emitJson(wire); return; }
        if (e.type === 'stream' && e.event.type === 'text_delta') process.stdout.write(e.event.delta);
        if (e.type === 'tool_start') process.stdout.write(`\n${orange('●')} ${e.toolCall.name} ${dim(preview(JSON.stringify(e.toolCall.arguments), 100))}\n`);
        if (e.type === 'tool_end') process.stdout.write(`  ${e.result.isError ? red('✗') : dim('✓')} ${dim(preview(e.result.content))}\n`);
        if (e.type === 'message' && e.message.role === 'user' && e.message.content !== prompt) process.stdout.write(dim(`\n↳ 插话已送达：${e.message.content}\n`));
      },
    });
    controller = undefined;
    await host.notify('agent_end', { reason });
    const last = messages.findLast(m => m.role === 'assistant');
    if (reason === 'error' && last?.role === 'assistant') say(red(`\n出错了：${last.errorMessage}\n`));
    if (reason === 'aborted') say(dim('\n（已取消）\n'));
    say('\n');
  }

  // #region resume
  // 上次的运行没有跑完（进程崩溃、被杀）：先补上中断的工具结果，再从断点继续（第 18 章）
  if (needsResume(session.messages())) {
    const calls = findInterrupted(session.messages());
    const results = await settleInterrupted(calls, allTools(), host.toolHooks());
    for (const r of results) {
      session.appendMessage(r);
      say(dim(`[恢复] ${r.toolName}：${r.content === INTERRUPTED ? '中断，交给模型查证' : '重放安全，已重新执行'}\n`));
    }
    say(dim('[恢复] 上次的运行没有完成，从断点继续\n'));
    await execute('');
  }
  // #endregion

  const once = argv.indexOf('-p');
  const shutdown = () => host.notify('session_shutdown', {});
  // #region modes
  if (mode === 'json') {
    emitJson({ type: 'session', id: session.header.id, file: session.file ?? null });
    await run(argv.slice(once + 1).filter(a => !a.startsWith('--')).join(' '));
    emitJson({ type: 'agent_settled' });
    await shutdown();
    return;
  }
  if (mode === 'rpc') {
    await startRpc({
      execute: prompt => run(prompt),
      isRunning: () => !!controller,
      steer: text => { steering.push({ role: 'user', content: text }); },
      abort: () => controller?.abort(),
      messages: () => session.messages(),
      state: () => ({ running: !!controller, sessionId: session.header.id, sessionFile: session.file ?? null, messageCount: session.messages().length, model: model.id }),
    }, emitJson);
    await shutdown();
    return;
  }
  // #endregion
  if (once !== -1) {
    await run(argv.slice(once + 1).join(' '));
    await shutdown();
    return;
  }

  const restored = session.messages().length;
  process.stdout.write(`${orange('mox')} ${dim(`· ${model.id} · ${cwd}`)}\n${dim(restored ? `已恢复会话 ${session.header.id}（${restored} 条消息）` : `新会话 ${session.header.id}`)}\n${dim('输入任务开始；运行中输入的文字会作为插话送达；Ctrl+C 取消；/tree 查看会话树。')}\n`);

  /** 会话树：缩进表示父子关系，● 标出当前分支。 */
  function printTree() {
    const onPath = new Set(session.path().map(e => e.id));
    const walk = (parent: string | null, depth: number) => {
      for (const e of session.children(parent)) {
        const text = e.type === 'message'
          ? `${e.message.role}: ${preview(e.message.role === 'user' ? e.message.content : e.message.role === 'assistant' ? e.message.content.map(b => (b.type === 'text' ? b.text : `[${b.name}]`)).join(' ') : `[${e.message.toolName}] ${e.message.content}`, 60)}`
          : e.type;
        process.stdout.write(`${'  '.repeat(depth)}${onPath.has(e.id) ? orange('●') : dim('○')} ${dim(e.id)} ${text}\n`);
        walk(e.id, depth + (session.children(parent).length > 1 ? 1 : 0));
      }
    };
    walk(null, 0);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '› ' });
  // 扩展要求用户选择时（比如权限确认），下一行输入就是答案，而不是插话（第 14 章）
  let answer: ((line: string) => void) | undefined;
  host.setSelect((title, options) => new Promise(resolve => {
    process.stdout.write(`\n${orange('?')} ${title}\n${options.map((o, i) => `  ${i + 1}. ${o}`).join('\n')}\n${dim('输入序号：')}`);
    answer = line => { answer = undefined; resolve(options[Number(line) - 1]); };
  }));
  let lastInterrupt = 0;
  rl.on('SIGINT', () => {
    if (controller) { controller.abort(); return; }
    if (Date.now() - lastInterrupt < 1500) void shutdown().finally(() => process.exit(0));
    lastInterrupt = Date.now();
    process.stdout.write(dim('\n再按一次 Ctrl+C 退出\n'));
    rl.prompt();
  });
  rl.prompt();
  for await (const line of rl) {
    const text = line.trim();
    if (answer) { answer(text); continue; }
    if (!text) { rl.prompt(); continue; }
    if (controller) { steering.push({ role: 'user', content: text }); continue; }   // 正在运行：作为插话排队
    if (text === '/tree') { printTree(); rl.prompt(); continue; }
    if (text === '/compact' || text.startsWith('/compact ')) {
      await maybeCompact(true, text.slice(8).trim() || undefined).catch(error => process.stdout.write(red(`${(error as Error).message}\n`)));
      rl.prompt();
      continue;
    }
    if (text === '/new') { session = Session.create(cwd); process.stdout.write(dim(`新会话 ${session.header.id}\n`)); rl.prompt(); continue; }
    const command = text.startsWith('/') ? host.commands.get(text.slice(1).split(' ')[0]) : undefined;
    if (command) {
      await Promise.resolve(command.handler(text.split(' ').slice(1).join(' '), { cwd })).catch(error => process.stdout.write(red(`${(error as Error).message}\n`)));
      rl.prompt();
      continue;
    }
    if (text.startsWith('/branch ')) {
      try { session.branch(text.slice(8).trim()); process.stdout.write(dim(`已回到 ${text.slice(8).trim()}，接下来的对话会开出一个新分支\n`)); }
      catch (error) { process.stdout.write(red(`${(error as Error).message}\n`)); }
      rl.prompt();
      continue;
    }
    run(text).catch(error => process.stdout.write(red(`\n${(error as Error).message}\n`))).finally(() => rl.prompt());
  }
  await shutdown();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => { console.error(red((error as Error).message)); process.exit(1); });
}
