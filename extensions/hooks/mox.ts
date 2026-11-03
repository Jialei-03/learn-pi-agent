// mox 扩展：兼容 Claude Code 的钩子（第 13 章）。协议部分与 Pi 版本共用 protocol.ts。
// 用法：node mox/src/cli.ts --ext extensions/hooks/mox.ts（配置写在 ~/.mox/hooks.json）
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MoxExtension } from '../../mox/src/extensions.ts';
import { fromClaudeInput, interpret, loadHooksConfig, outputText, runHooks, toClaudeResponse, toClaudeTool, type HookEvent, type Verdict } from './protocol.ts';

export function createHooksMoxExtension(files = [join(homedir(), '.mox', 'hooks.json')], onNotice: (text: string) => void = t => process.stderr.write(`[hooks] ${t}\n`)): MoxExtension {
  return api => {
    const { config, errors } = loadHooksConfig(files);
    errors.forEach(onNotice);
    const sessionId = `mox-${Date.now()}`;
    let cwd = process.cwd();
    let sessionContext: string[] = [];
    const toolContext = new Map<string, string[]>();
    let stopHookActive = false;

    const run = async (event: HookEvent, input: Record<string, unknown>, toolName?: string): Promise<Verdict> => {
      const verdict = interpret(event, await runHooks(config, event, { session_id: sessionId, cwd, permission_mode: 'default', ...input }, { cwd, projectDir: cwd, toolName }));
      verdict.notices.forEach(onNotice);
      return verdict;
    };

    api.on('session_start', async event => {
      cwd = event.cwd;
      sessionContext = (await run('SessionStart', { source: 'startup' })).context;
    });

    // mox 没有“隐藏消息”，UserPromptSubmit 的补充信息直接附在用户消息后面
    api.on('input', async event => {
      stopHookActive = false;
      const verdict = await run('UserPromptSubmit', { prompt: event.text });
      if (verdict.block) { onNotice(`提示被钩子拦下：${verdict.block}`); return { handled: true }; }
      if (verdict.context.length) return { text: `${event.text}\n\n<hook-context event="UserPromptSubmit">\n${verdict.context.join('\n')}\n</hook-context>` };
    });

    api.on('before_agent_start', event => {
      if (sessionContext.length) return { systemPrompt: `${event.systemPrompt}\n\n<hook-context event="SessionStart">\n${sessionContext.join('\n')}\n</hook-context>` };
    });

    api.on('tool_call', async event => {
      const { tool_name, tool_input } = toClaudeTool(event.toolName, event.input, cwd);
      const verdict = await run('PreToolUse', { tool_name, tool_input, tool_use_id: event.toolCall.id }, tool_name);
      if (verdict.context.length) toolContext.set(event.toolCall.id, verdict.context);
      // mox 没有确认界面：ask 一律按拒绝处理（宁可多拦）
      if (verdict.block) return { block: true, reason: verdict.permission === 'ask' ? `${verdict.block}（需要用户确认，mox 没有确认界面）` : verdict.block };
      if (verdict.updatedInput) {
        const next = fromClaudeInput(event.toolName, verdict.updatedInput);
        for (const key of Object.keys(event.input)) delete event.input[key];
        Object.assign(event.input, next);
      }
    });

    api.on('tool_result', async event => {
      const { tool_name, tool_input } = toClaudeTool(event.toolName, event.input, cwd);
      const id = event.toolCall.id;
      const verdict = await run('PostToolUse', { tool_name, tool_input, tool_response: toClaudeResponse(event.toolName, event.result.content, !!event.result.isError), tool_use_id: id }, tool_name);
      const extra = [...(toolContext.get(id) ?? []), ...verdict.context];
      toolContext.delete(id);
      if (verdict.updatedOutput === undefined && !extra.length) return;
      const base = verdict.updatedOutput !== undefined ? outputText(verdict.updatedOutput) : event.result.content;
      return { content: extra.length ? `${base}\n\n<hook-context event="PostToolUse">\n${extra.join('\n')}\n</hook-context>` : base };
    });

    api.on('before_settle', async event => {
      const last = event.messages.findLast(m => m.role === 'assistant');
      const text = last?.role === 'assistant' ? last.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('') : '';
      const verdict = await run('Stop', { stop_hook_active: stopHookActive, last_assistant_message: text });
      if (!verdict.block) return;
      stopHookActive = true;
      return { followUp: `Stop 钩子：${verdict.block}` };
    });

    api.on('session_shutdown', async () => { await run('SessionEnd', { reason: 'exit' }); });
  };
}

export default createHooksMoxExtension();
