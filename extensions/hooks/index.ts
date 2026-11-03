// Pi 扩展：兼容 Claude Code 的钩子（第 13 章）。
// 读取 ~/.pi/agent/hooks.json 和（信任项目后）.pi/hooks.json，格式与 Claude Code 的 settings.json 中的 "hooks" 一样。
// 把 Claude Code 的钩子事件对应到 Pi 的扩展事件：
//   SessionStart → session_start     UserPromptSubmit → input + before_agent_start
//   PreToolUse   → tool_call         PostToolUse      → tool_result
//   Stop         → agent_before_settle                SessionEnd → session_shutdown
import { join } from 'node:path';
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { fromClaudeInput, interpret, loadHooksConfig, outputText, runHooks, toClaudeResponse, toClaudeTool, type HookEvent, type HooksConfig, type Verdict } from './protocol.ts';

export interface HooksExtensionOptions {
  /** 配置文件；默认是用户级 hooks.json，加上信任项目后的 .pi/hooks.json */
  files?: (ctx: ExtensionContext) => string[];
}

export function createHooksExtension(options: HooksExtensionOptions = {}) {
  return (pi: ExtensionAPI) => {
    let config: HooksConfig = {};
    let sessionContext: string[] = [];
    let promptContext: string[] = [];
    const toolContext = new Map<string, string[]>();
    let stopHookActive = false;
    let lastAssistantText = '';

    const common = (ctx: ExtensionContext) => ({
      session_id: ctx.sessionManager.getSessionId(),
      transcript_path: ctx.sessionManager.getSessionFile(),
      cwd: ctx.cwd,
      permission_mode: 'default',
    });
    const run = async (event: HookEvent, ctx: ExtensionContext, input: Record<string, unknown>, toolName?: string): Promise<Verdict> => {
      const verdict = interpret(event, await runHooks(config, event, { ...common(ctx), ...input }, { cwd: ctx.cwd, projectDir: ctx.cwd, toolName }));
      for (const notice of verdict.notices) ctx.ui.notify(notice, 'warning');
      if (verdict.stop) { ctx.ui.notify(`钩子要求停止：${verdict.stop}`, 'warning'); ctx.abort(); }
      return verdict;
    };

    pi.on('session_start', async (event, ctx) => {
      const files = options.files?.(ctx) ?? [join(getAgentDir(), 'hooks.json'), ...(ctx.isProjectTrusted() ? [join(ctx.cwd, '.pi', 'hooks.json')] : [])];
      const loaded = loadHooksConfig(files);
      config = loaded.config;
      for (const error of loaded.errors) ctx.ui.notify(`[hooks] ${error}`, 'warning');
      sessionContext = (await run('SessionStart', ctx, { source: event.reason === 'resume' ? 'resume' : 'startup' })).context;
    });

    // 用户提交的提示：钩子可以拦下它，或者给模型补充信息（不能改写提示本身）
    pi.on('input', async (event, ctx) => {
      if (event.source === 'extension') return;
      stopHookActive = false;
      const verdict = await run('UserPromptSubmit', ctx, { prompt: event.text });
      if (verdict.block) {
        ctx.ui.notify(`提示被钩子拦下：${verdict.block}`, 'warning');
        return { action: 'handled' };
      }
      promptContext = verdict.context;
    });

    // SessionStart 的信息放进系统提示的一个小节（整个会话不变，不破坏缓存）；UserPromptSubmit 的信息作为一条隐藏消息跟在提示后面
    pi.on('before_agent_start', async event => {
      if (sessionContext.length) event.systemPromptOptions.sections.hook_context = `<hook-context event="SessionStart">\n${sessionContext.join('\n')}\n</hook-context>`;
      if (!promptContext.length) return;
      const content = `<hook-context event="UserPromptSubmit">\n${promptContext.join('\n')}\n</hook-context>`;
      promptContext = [];
      return { message: { customType: 'hook-context', content, display: false } };
    });

    pi.on('tool_call', async (event, ctx) => {
      const input = event.input as Record<string, unknown>;
      const { tool_name, tool_input } = toClaudeTool(event.toolName, input, ctx.cwd);
      const verdict = await run('PreToolUse', ctx, { tool_name, tool_input, tool_use_id: event.toolCallId }, tool_name);
      if (verdict.context.length) toolContext.set(event.toolCallId, verdict.context);
      if (verdict.permission === 'ask') {
        if (!ctx.hasUI) return { block: true, reason: `${verdict.block}（钩子要求用户确认，但当前没有界面）` };
        const ok = await ctx.ui.confirm('钩子要求确认', `${tool_name} ${JSON.stringify(tool_input)}\n\n${verdict.block}`);
        if (!ok) return { block: true, reason: '用户拒绝了这次调用' };
      } else if (verdict.block) {
        return { block: true, reason: verdict.block };
      }
      if (verdict.updatedInput) {
        // Pi 的约定：改参数就地修改 event.input
        const next = fromClaudeInput(event.toolName, verdict.updatedInput);
        for (const key of Object.keys(input)) delete input[key];
        Object.assign(input, next);
      }
    });

    pi.on('tool_result', async (event, ctx) => {
      const text = event.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
      const { tool_name, tool_input } = toClaudeTool(event.toolName, event.input, ctx.cwd);
      const verdict = await run('PostToolUse', ctx, { tool_name, tool_input, tool_response: toClaudeResponse(event.toolName, text, event.isError), tool_use_id: event.toolCallId }, tool_name);
      const extra = [...(toolContext.get(event.toolCallId) ?? []), ...verdict.context];
      toolContext.delete(event.toolCallId);
      if (verdict.updatedOutput === undefined && !extra.length) return;
      const base = verdict.updatedOutput !== undefined ? outputText(verdict.updatedOutput) : text;
      const images = event.content.filter(c => c.type === 'image');
      return {
        content: [{ type: 'text' as const, text: extra.length ? `${base}\n\n<hook-context event="PostToolUse">\n${extra.join('\n')}\n</hook-context>` : base }, ...images],
        // 改写了内容，结构化结果也要一起替换，否则旧数据会从另一条路漏出去
        ...(verdict.updatedOutput !== undefined ? { structuredContent: undefined } : {}),
      };
    });

    pi.on('message_end', async event => {
      const m = event.message as { role: string; content?: unknown };
      if (m.role === 'assistant' && Array.isArray(m.content)) lastAssistantText = m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    });

    // 模型准备停下时：Stop 钩子可以说“还不行”，把原因交给模型，再跑一轮
    pi.on('agent_before_settle', async (event, ctx) => {
      const verdict = await run('Stop', ctx, { stop_hook_active: stopHookActive, last_assistant_message: lastAssistantText });
      if (!verdict.block) return;
      stopHookActive = true;   // 让钩子知道这一轮是它要求的，避免无限循环
      return {
        entries: [...event.entries, { type: 'custom_message' as const, customType: 'hook-stop', content: `Stop 钩子：${verdict.block}`, display: true }],
        continue: true,
      };
    });

    pi.on('session_shutdown', async (_event, ctx) => { await run('SessionEnd', ctx, { reason: 'exit' }); });
  };
}

export default createHooksExtension();
