// mox 扩展：规则式权限（第 14 章）。规则判断与 Pi 版本共用 rules.ts。
// 用法：node mox/src/cli.ts --ext extensions/permissions/mox.ts（规则写在 ~/.mox/permissions.json）
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MoxExtension } from '../../mox/src/extensions.ts';
import { decidePermission, loadPermissionSettings, MODES, parseRule, suggestRules, type Mode, type Rule } from './rules.ts';

export function createPermissionsMoxExtension(files = [{ path: join(homedir(), '.mox', 'permissions.json'), base: join(homedir(), '.mox') }], initialMode?: Mode): MoxExtension {
  return api => {
    const settings = loadPermissionSettings(files);
    settings.errors.forEach(e => process.stderr.write(`[permissions] ${e}\n`));
    let mode: Mode = initialMode ?? settings.defaultMode ?? 'default';
    const sessionRules: Rule[] = [];

    api.on('tool_call', async (event, ctx) => {
      const pctx = { cwd: ctx.cwd, mode, rules: [...settings.rules, ...sessionRules], additionalDirectories: settings.additionalDirectories };
      const decision = decidePermission(event.toolName, event.input, pctx);
      if (decision.behavior === 'allow') return;
      if (decision.behavior === 'deny') return { block: true, reason: `权限：${decision.reason}` };
      if (!ctx.select) return { block: true, reason: `权限：${decision.reason}。当前没有界面可以确认，已拒绝` };
      const summary = event.toolName === 'bash' ? String(event.input.command) : `${event.toolName} ${JSON.stringify(event.input).slice(0, 200)}`;
      const choice = await ctx.select(`允许执行吗？${summary}（${decision.reason}）`, ['允许一次', '本会话都允许', '拒绝']);
      if (choice === '允许一次') return;
      if (choice === '本会话都允许') { for (const t of suggestRules(event.toolName, event.input, pctx)) sessionRules.push(parseRule(t, 'allow', ctx.cwd)); return; }
      return { block: true, reason: '用户拒绝了这次调用' };
    });

    api.registerCommand('mode', {
      description: '切换权限模式',
      handler: args => {
        if (MODES.includes(args.trim() as Mode)) mode = args.trim() as Mode;
        process.stdout.write(`权限模式：${mode}\n`);
      },
    });
  };
}

export default createPermissionsMoxExtension();
