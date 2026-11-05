// mox 扩展：兼容 Claude Code 的钩子（第 13 章）。协议部分与 Pi 版本共用 protocol.ts。
//   mox -e extensions/hooks/mox.ts          配置写在 ~/.mox/hooks.json
//
// mox 的工具名和参数与 Pi 一致（read、write、edit、bash……），所以工具名和参数的翻译（toClaudeTool / fromClaudeInput）直接用 protocol.ts 里的。
// 把 Claude Code 的钩子事件对应到 mox 扩展接口的四个事件：
//   PreToolUse  → on('tool_call')（deny → 返回理由，allow → 返回 true，ask → mox.ask）    PostToolUse → on('tool_result')
//   Stop        → on('agent_end')    SessionEnd  → on('shutdown')
//   SessionStart → 没有事件，在扩展函数里直接运行，结果用 addSystemPrompt 放进系统提示
//   UserPromptSubmit → mox 没有看到用户输入的入口，对应不上，配置了也不会运行（启动时提示一次）
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionApi } from '../../mox/src/extensions.ts';
import { fromClaudeInput, interpret, loadHooksConfig, outputText, runHooks, toClaudeResponse, toClaudeTool, type HookEvent, type Verdict } from './protocol.ts';

const hookContext = (event: string, lines: string[]) => `<hook-context event="${event}">\n${lines.join('\n')}\n</hook-context>`;

export function createHooksMoxExtension(files = [join(homedir(), '.mox', 'hooks.json')], onNotice: (text: string) => void = t => process.stderr.write(`[hooks] ${t}\n`)) {
  return async (mox: ExtensionApi) => {
    const { config, errors } = loadHooksConfig(files);
    errors.forEach(onNotice);
    if (config.UserPromptSubmit) onNotice('mox 没有对应 UserPromptSubmit 的事件，这类钩子不会运行');
    const cwd = mox.cwd;
    const sessionId = `mox-${Date.now()}`;
    const toolContext = new WeakMap<object, string[]>();          // PreToolUse 留下的补充信息，按 args 对象对应到同一次调用的结果
    let stopHookActive = false;

    const run = async (event: HookEvent, input: Record<string, unknown>, toolName?: string): Promise<Verdict> => {
      const verdict = interpret(event, await runHooks(config, event, { session_id: sessionId, cwd, permission_mode: 'default', ...input }, { cwd, projectDir: cwd, toolName }));
      verdict.notices.forEach(onNotice);
      if (verdict.stop) onNotice(`钩子要求停止：${verdict.stop}（mox 的扩展没有中止运行的入口，已忽略）`);
      return verdict;
    };

    // #region session-start
    // SessionStart：扩展函数可以是 async，加载时会被 await，所以直接在这里运行钩子。信息整个会话不变，放进系统提示
    const sessionContext = (await run('SessionStart', { source: 'startup' })).context;
    if (sessionContext.length) mox.addSystemPrompt(() => hookContext('SessionStart', sessionContext));
    // #endregion

    // #region pre-tool-use
    mox.on('tool_call', async (name, args) => {
      const { tool_name, tool_input } = toClaudeTool(name, args, cwd);
      const verdict = await run('PreToolUse', { tool_name, tool_input }, tool_name);
      let approved = verdict.permission === 'allow';        // 钩子明确说了 allow：返回 true，mox 就放行、跳过内置的用户确认
      if (verdict.context.length) toolContext.set(args, verdict.context);
      if (verdict.block) {
        if (verdict.permission !== 'ask') return verdict.block;
        // 钩子要求用户确认：用 mox.ask 问；没有终端（返回 undefined）就按拒绝处理
        if ((await mox.ask(`${verdict.block}\n允许 ${tool_name} 继续吗？`, ['拒绝', '允许'])) !== '允许') return verdict.block;
        approved = true;                                   // 用户刚刚亲口批准了，不必再被内置的确认问第二遍
      }
      if (verdict.updatedInput) {
        // 改写参数：args 就是后面 tool.run 要用的同一个对象，就地修改即可；会话里记录的仍是模型发出的原始调用
        const next = fromClaudeInput(name, verdict.updatedInput);
        for (const key of Object.keys(args)) delete args[key];
        Object.assign(args, next);
      }
      return approved ? true : undefined;
    });
    // #endregion

    // #region post-tool-use
    mox.on('tool_result', async (name, args, result) => {
      const { tool_name, tool_input } = toClaudeTool(name, args, cwd);
      const verdict = await run('PostToolUse', { tool_name, tool_input, tool_response: toClaudeResponse(name, result, false) }, tool_name);
      const extra = [...(toolContext.get(args) ?? []), ...verdict.context];
      toolContext.delete(args);
      if (verdict.updatedOutput === undefined && !extra.length) return;
      const base = verdict.updatedOutput !== undefined ? outputText(verdict.updatedOutput) : result;
      return extra.length ? `${base}\n\n${hookContext('PostToolUse', extra)}` : base;
    });
    // #endregion

    // #region stop
    mox.on('agent_end', async answer => {
      const verdict = await run('Stop', { stop_hook_active: stopHookActive, last_assistant_message: answer });
      stopHookActive = !!verdict.block;                  // 这一轮如果被拦下，下一轮就是 Stop 钩子要求的
      if (verdict.block) return `Stop 钩子：${verdict.block}`;
    });
    // #endregion

    mox.on('shutdown', async () => { await run('SessionEnd', { reason: 'exit' }); });
  };
}

export default createHooksMoxExtension();
