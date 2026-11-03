// Pi 扩展：规则式权限（第 14 章）。Pi 默认不做任何审批，这个扩展补上 allow / ask / deny 规则和权限模式。
// 配置：~/.pi/agent/permissions.json，以及（信任项目后的）.pi/permissions.json，格式与 Claude Code settings.json 中的 "permissions" 相同。
// 命令：/permissions 查看规则；/mode <default|acceptEdits|plan|dontAsk|bypassPermissions> 切换模式。
import { join } from 'node:path';
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { decidePermission, deniedTools, loadPermissionSettings, MODES, parseRule, suggestRules, type Mode, type PermissionContext, type Rule } from './rules.ts';

export interface PermissionsOptions {
  files?: (ctx: ExtensionContext) => { path: string; base: string }[];
  mode?: Mode;
}

export function createPermissionsExtension(options: PermissionsOptions = {}) {
  return (pi: ExtensionAPI) => {
    let rules: Rule[] = [];
    const sessionRules: Rule[] = [];
    let mode: Mode = options.mode ?? 'default';
    let additionalDirectories: string[] = [];
    // 扩展注册的工具可以声明 readOnlyHint（扩展是受信任的代码）；MCP 服务器的声明不可信（第 12 章），不算
    const readOnlyTools = () => new Set(pi.getAllTools().filter(t => t.annotations?.readOnlyHint === true && !t.name.startsWith('mcp__')).map(t => t.name));
    const context = (ctx: ExtensionContext): PermissionContext => ({ cwd: ctx.cwd, mode, rules: [...rules, ...sessionRules], additionalDirectories, readOnlyTools: readOnlyTools() });
    const showMode = (ctx: ExtensionContext) => ctx.ui.setStatus('permissions', mode === 'default' ? undefined : `权限：${mode}`);

    pi.on('session_start', async (_event, ctx) => {
      const agentDir = getAgentDir();
      const files = options.files?.(ctx) ?? [
        { path: join(agentDir, 'permissions.json'), base: agentDir },
        ...(ctx.isProjectTrusted() ? [{ path: join(ctx.cwd, '.pi', 'permissions.json'), base: ctx.cwd }] : []),
      ];
      const settings = loadPermissionSettings(files);
      rules = settings.rules;
      mode = options.mode ?? settings.defaultMode ?? 'default';
      additionalDirectories = settings.additionalDirectories;
      for (const error of settings.errors) ctx.ui.notify(`[permissions] ${error}`, 'warning');
      // 整个工具被禁止：直接从模型能看到的工具里去掉，模型就不会去尝试
      const denied = deniedTools(pi.getActiveTools(), rules);
      if (denied.length) pi.setActiveTools(pi.getActiveTools().filter(name => !denied.includes(name)));
      showMode(ctx);
    });

    pi.on('tool_call', async (event, ctx) => {
      const input = event.input as Record<string, unknown>;
      const decision = decidePermission(event.toolName, input, context(ctx));
      if (decision.behavior === 'allow') return;
      if (decision.behavior === 'deny') return { block: true, reason: `权限：${decision.reason}` };
      // ask：没有界面就没人能批准，按拒绝处理（出错时拒绝，和第 9 章的权限示例一样）
      if (!ctx.hasUI) return { block: true, reason: `权限：${decision.reason}。当前没有界面可以确认，已拒绝` };
      const summary = event.toolName === 'bash' ? String(input.command) : `${event.toolName} ${JSON.stringify(input).slice(0, 200)}`;
      const choice = await ctx.ui.select(`允许执行吗？\n${summary}\n（${decision.reason}）`, ['允许一次', '本会话都允许', '拒绝']);
      if (choice === '允许一次') return;
      if (choice === '本会话都允许') {
        for (const text of suggestRules(event.toolName, input, context(ctx))) sessionRules.push(parseRule(text, 'allow', ctx.cwd));
        return;
      }
      return { block: true, reason: '用户拒绝了这次调用' };
    });

    // 其他扩展可以切换模式，比如第 16 章的计划模式在用户批准计划后切到 acceptEdits
    pi.events.on('permissions:set-mode', data => {
      if (MODES.includes(data as Mode)) mode = data as Mode;
    });

    pi.registerCommand('permissions', {
      description: '查看当前的权限模式和规则',
      handler: async (_args, ctx) => {
        const lines = [`模式：${mode}`, ...[...rules, ...sessionRules].map(r => `${r.behavior.padEnd(5)} ${r.text}${sessionRules.includes(r) ? '（本会话）' : ''}`)];
        ctx.ui.notify(lines.join('\n'), 'info');
      },
    });
    pi.registerCommand('mode', {
      description: '切换权限模式：default、acceptEdits、plan、dontAsk、bypassPermissions',
      handler: async (args, ctx) => {
        const next = args.trim() as Mode;
        if (!MODES.includes(next)) { ctx.ui.notify(`可选的模式：${MODES.join('、')}`, 'warning'); return; }
        mode = next;
        showMode(ctx);
        ctx.ui.notify(`权限模式：${mode}`, 'info');
      },
    });
  };
}

export default createPermissionsExtension();
