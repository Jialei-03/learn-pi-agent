// Claude Code 钩子协议的实现（第 13 章），Pi 扩展和 mox 扩展共用。
// 钩子是一条外部命令：事件发生时，Agent 把事件写成 JSON 交给它的 stdin，再根据退出码和 stdout 决定怎么做。
// 配置格式、输入字段、退出码和 JSON 输出都按 Claude Code 的文档实现，同一份钩子脚本可以在三个 Agent 里使用：
//   https://code.claude.com/docs/en/hooks
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export type HookEvent = 'SessionStart' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse' | 'Stop' | 'SessionEnd';
export const HOOK_EVENTS: HookEvent[] = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd'];

export interface CommandHook { type: 'command'; command: string; timeout?: number; onFailure?: 'block' }
export interface HookMatcher { matcher?: string; hooks: CommandHook[] }
export type HooksConfig = Partial<Record<HookEvent, HookMatcher[]>>;

/** 读取一个或多个配置文件（格式：{ "hooks": { "PreToolUse": [...] } }），按事件合并。 */
export function loadHooksConfig(files: string[]): { config: HooksConfig; errors: string[] } {
  const config: HooksConfig = {};
  const errors: string[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    try {
      const hooks = JSON.parse(readFileSync(file, 'utf8')).hooks ?? {};
      for (const [event, matchers] of Object.entries<HookMatcher[]>(hooks)) {
        if (!HOOK_EVENTS.includes(event as HookEvent)) { errors.push(`${file}：暂不支持 ${event} 事件，已忽略`); continue; }
        (config[event as HookEvent] ??= []).push(...matchers);
      }
    } catch (error) { errors.push(`${file}：${(error as Error).message}`); }
  }
  return { config, errors };
}

/**
 * matcher 的规则：空、* 或省略 → 全部匹配；只含字母、数字、_、-、空格、逗号、竖线 → 精确匹配其中之一；
 * 否则当作不锚定的正则表达式（比如 mcp__github__.*）。只有工具事件看 matcher。
 */
export function matches(matcher: string | undefined, toolName: string | undefined): boolean {
  if (toolName === undefined || !matcher || matcher === '*') return true;
  if (/^[A-Za-z0-9_\- ,|]+$/.test(matcher)) return matcher.split(/[|,]/).map(s => s.trim()).includes(toolName);
  try { return new RegExp(matcher).test(toolName); } catch { return false; }
}

export interface HookRun {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  onFailure?: 'block';
  /** stdout 恰好是一个 JSON 对象时，解析后的结果 */
  json?: Record<string, any>;
}

/** 运行一条钩子命令：输入 JSON 写进 stdin；超时杀掉整个进程组。 */
export function runCommand(hook: CommandHook, input: object, options: { cwd: string; projectDir: string }): Promise<HookRun> {
  const command = hook.command.replaceAll('${CLAUDE_PROJECT_DIR}', options.projectDir);
  return new Promise(resolvePromise => {
    const child = spawn('sh', ['-c', command], {
      cwd: options.cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_PROJECT_DIR: options.projectDir },
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid!, 'SIGKILL'); } catch {} }, (hook.timeout ?? 600) * 1000);
    child.on('error', error => { clearTimeout(timer); resolvePromise({ command, exitCode: null, stdout, stderr: error.message, timedOut, onFailure: hook.onFailure }); });
    child.on('close', code => {
      clearTimeout(timer);
      let json: Record<string, any> | undefined;
      const trimmed = stdout.trim();
      if (code === 0 && trimmed.startsWith('{')) { try { json = JSON.parse(trimmed); } catch {} }
      resolvePromise({ command, exitCode: timedOut ? null : code, stdout, stderr, timedOut, onFailure: hook.onFailure, json });
    });
    child.stdin.on('error', () => {});                 // 钩子不读 stdin 就退出时，写入会失败，忽略即可
    child.stdin.end(JSON.stringify(input));
  });
}

/** 找出匹配的钩子并行运行。同一条命令在多个配置里出现，只运行一次。 */
export async function runHooks(config: HooksConfig, event: HookEvent, input: Record<string, unknown>, options: { cwd: string; projectDir: string; toolName?: string }): Promise<HookRun[]> {
  const commands = new Map<string, CommandHook>();
  for (const m of config[event] ?? []) {
    if (!matches(m.matcher, options.toolName)) continue;
    for (const hook of m.hooks) if (hook.type === 'command' && !commands.has(hook.command)) commands.set(hook.command, hook);
  }
  return Promise.all([...commands.values()].map(hook => runCommand(hook, { hook_event_name: event, cwd: options.cwd, ...input }, options)));
}

// ── 解读结果 ──────────────────────────────────────────

/** 退出码 2 = 阻止；其他非零 = 不阻止的错误（除非配置了 onFailure: "block"）；0 = 成功，看 stdout。 */
const blocked = (r: HookRun) => r.exitCode === 2 || (r.exitCode !== 0 && r.onFailure === 'block');
const failureNote = (r: HookRun) => (r.exitCode !== 0 && !blocked(r) ? `钩子出错（${r.timedOut ? '超时' : `退出码 ${r.exitCode}`}），已忽略：${r.command}` : undefined);
const reasonOf = (r: HookRun) => r.stderr.trim() || (r.timedOut ? `钩子超时：${r.command}` : `钩子失败：${r.command}`);

export interface Verdict {
  /** 阻止这次操作（工具调用、提交提示）；对 Stop 来说是“不要停” */
  block?: string;
  /** PreToolUse：allow / ask / deny */
  permission?: 'allow' | 'ask' | 'deny';
  updatedInput?: Record<string, unknown>;
  updatedOutput?: unknown;
  /** 要交给模型的补充信息 */
  context: string[];
  /** 只给用户看的提示 */
  notices: string[];
  /** continue: false —— 让 Agent 整个停下 */
  stop?: string;
}

/** 合并多个钩子的结果。PreToolUse 的优先级：deny > ask > allow。 */
export function interpret(event: HookEvent, runs: HookRun[]): Verdict {
  const v: Verdict = { context: [], notices: [] };
  const rank = { allow: 1, ask: 2, deny: 3 } as const;
  for (const r of runs) {
    const note = failureNote(r);
    if (note) { v.notices.push(note); continue; }
    if (blocked(r)) {
      if (event === 'PostToolUse') v.context.push(reasonOf(r));          // 工具已经执行过了，只能告诉模型
      else if (event === 'PreToolUse') { v.permission = 'deny'; v.block ??= reasonOf(r); }
      else if (event !== 'SessionStart' && event !== 'SessionEnd') v.block ??= reasonOf(r);
      continue;
    }
    const j = r.json;
    if (!j) {
      // 纯文本的 stdout 只有这两个事件会交给模型
      if ((event === 'SessionStart' || event === 'UserPromptSubmit') && r.stdout.trim()) v.context.push(r.stdout.trim());
      continue;
    }
    if (j.continue === false) v.stop ??= j.stopReason ?? '钩子要求停止';
    if (j.systemMessage) v.notices.push(j.systemMessage);
    const specific = j.hookSpecificOutput ?? {};
    if (specific.additionalContext) v.context.push(String(specific.additionalContext).slice(0, 10_000));
    if (event === 'PreToolUse') {
      const decision = specific.permissionDecision as Verdict['permission'] | undefined;
      if (decision && rank[decision] && (!v.permission || rank[decision] > rank[v.permission])) {
        v.permission = decision;
        if (decision !== 'allow') v.block = specific.permissionDecisionReason ?? `钩子拒绝：${r.command}`;
      }
      if (specific.updatedInput) v.updatedInput = specific.updatedInput;
    } else if (event === 'PostToolUse') {
      if (j.decision === 'block' && j.reason) v.context.push(j.reason);
      if (specific.updatedToolOutput !== undefined) v.updatedOutput = specific.updatedToolOutput;
    } else if (j.decision === 'block') {
      v.block ??= j.reason ?? `钩子阻止：${r.command}`;
    }
  }
  if (v.permission === 'allow') v.block = undefined;
  return v;
}

// ── Pi / mox 的工具 ↔ Claude Code 的工具 ──────────────────────

const CLAUDE_NAMES: Record<string, string> = { bash: 'Bash', read: 'Read', write: 'Write', edit: 'Edit', grep: 'Grep', find: 'Glob', ls: 'LS' };
const OUR_NAMES = Object.fromEntries(Object.entries(CLAUDE_NAMES).map(([a, b]) => [b, a]));

/** 把工具名和参数翻译成 Claude Code 的形状，这样为 Claude Code 写的钩子脚本不用改就能用。MCP 工具名本来就一致。 */
export function toClaudeTool(name: string, input: Record<string, any>, cwd: string): { tool_name: string; tool_input: Record<string, unknown> } {
  const tool_name = CLAUDE_NAMES[name] ?? name;
  const file_path = typeof input.path === 'string' ? (isAbsolute(input.path) ? input.path : resolve(cwd, input.path)) : undefined;
  switch (name) {
    case 'read': return { tool_name, tool_input: { file_path, offset: input.offset, limit: input.limit } };
    case 'write': return { tool_name, tool_input: { file_path, content: input.content } };
    case 'edit': {
      const edits = (input.edits ?? []) as { oldText: string; newText: string }[];
      return { tool_name, tool_input: edits.length === 1 ? { file_path, old_string: edits[0].oldText, new_string: edits[0].newText } : { file_path, edits: edits.map(e => ({ old_string: e.oldText, new_string: e.newText })) } };
    }
    case 'bash': return { tool_name, tool_input: { command: input.command, ...(input.timeout ? { timeout: input.timeout * 1000 } : {}) } };
    default: return { tool_name, tool_input: input };
  }
}

/** 钩子用 updatedInput 改写了参数：翻译回我们的形状。 */
export function fromClaudeInput(name: string, updated: Record<string, any>): Record<string, unknown> {
  const ours = OUR_NAMES[CLAUDE_NAMES[name] ?? ''] ?? name;
  const path = updated.file_path;
  switch (ours) {
    case 'read': return { path, offset: updated.offset, limit: updated.limit };
    case 'write': return { path, content: updated.content };
    case 'edit': return { path, edits: updated.edits ? updated.edits.map((e: any) => ({ oldText: e.old_string, newText: e.new_string })) : [{ oldText: updated.old_string, newText: updated.new_string }] };
    case 'bash': return { command: updated.command, ...(updated.timeout ? { timeout: updated.timeout / 1000 } : {}) };
    default: return updated;
  }
}

/** 把工具结果转成 Claude Code 风格的 tool_response（Bash 是 stdout/stderr，其他工具给文本）。 */
export function toClaudeResponse(name: string, text: string, isError: boolean): unknown {
  return name === 'bash' ? { stdout: isError ? '' : text, stderr: isError ? text : '', interrupted: false } : { output: text, is_error: isError };
}

/** updatedToolOutput 可能是字符串，也可能是 { stdout } 之类的对象：取出要交给模型的文本。 */
export function outputText(updated: unknown): string {
  if (typeof updated === 'string') return updated;
  const o = updated as Record<string, unknown>;
  return String(o?.stdout ?? o?.output ?? JSON.stringify(updated));
}
