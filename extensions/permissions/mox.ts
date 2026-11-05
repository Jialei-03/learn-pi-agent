// mox 扩展：规则式权限（第 14 章）。规则判断和 Pi 版本共用 rules.ts，这里只负责接进 mox 的 tool_call 和 ask。
// 用法：mox -e extensions/permissions/mox.ts（规则写在 ~/.mox/permissions.json，格式同 Claude Code 的 "permissions"）。
// tool_call 的返回值有三种：字符串 = 拒绝（理由给模型看），true = 放行（跳过 mox 内置的确认），不返回 = 没有意见（交给后面的扩展和内置确认）。
// 这个扩展对每个调用都给出明确的结论：allow 返回 true，deny 返回理由，ask 自己问用户再返回 true 或理由。
// 每个扩展的 tool_call 都会被调用，拒绝优先：只要有一个返回字符串就拒绝，安全不取决于加载顺序。
// 顺序只影响体验：这个扩展排在计划模式前面时，用户会先被问一次，随后计划模式照样拒绝，等于白问。
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionApi } from '../../mox/src/extensions.ts';
import { decidePermission, loadPermissionSettings, MODES, parseRule, suggestRules, type Mode, type Rule } from './rules.ts';

const defaultFiles = () => [{ path: join(homedir(), '.mox', 'permissions.json'), base: join(homedir(), '.mox') }];
/** 只改变 Agent 自己状态的工具：子 Agent、任务清单、提交计划。它们发起的真正操作会单独经过检查 */
const INTERNAL_TOOLS = ['task', 'todo_write', 'exit_plan_mode'];

export function createPermissionsMoxExtension(files = defaultFiles(), initialMode?: Mode, internalTools = INTERNAL_TOOLS) {
  return (mox: ExtensionApi) => {
    const settings = loadPermissionSettings(files);
    settings.errors.forEach(e => process.stderr.write(`[permissions] ${e}\n`));
    let mode: Mode = initialMode ?? settings.defaultMode ?? 'default';
    const sessionRules: Rule[] = [];
    const context = () => ({ cwd: mox.cwd, mode, rules: [...settings.rules, ...sessionRules], additionalDirectories: settings.additionalDirectories, readOnlyTools: new Set(internalTools) });

    mox.on('tool_call', async (name: string, args: Record<string, unknown>) => {
      const decision = decidePermission(name, args, context());
      if (decision.behavior === 'allow') return true;
      if (decision.behavior === 'deny') return `权限：${decision.reason}`;
      const summary = name === 'bash' ? String(args.command) : `${name} ${JSON.stringify(args).slice(0, 200)}`;
      const choice = await mox.ask(`允许执行吗？${summary}（${decision.reason}）`, ['允许一次', '本会话都允许', '拒绝']);
      if (choice === '允许一次') return true;
      if (choice === '本会话都允许') {
        for (const text of suggestRules(name, args, context())) sessionRules.push(parseRule(text, 'allow', mox.cwd));
        return true;
      }
      // ask 没有得到回答（没有终端、输入了无效序号）和用户点“拒绝”一样处理：出错时拒绝
      return choice === undefined ? `权限：${decision.reason}。当前没有终端可以确认，已拒绝` : '用户拒绝了这次调用';
    });

    mox.registerCommand('permissions', arg => {
      const next = String(arg).trim();
      if (MODES.includes(next as Mode)) mode = next as Mode;
      const rules = [...settings.rules, ...sessionRules].map(r => `  ${r.behavior.padEnd(5)} ${r.text}${sessionRules.includes(r) ? '（本会话）' : ''}`);
      process.stdout.write(`权限模式：${mode}\n${rules.join('\n')}${rules.length ? '\n' : ''}`);
    });
  };
}

export default createPermissionsMoxExtension();
