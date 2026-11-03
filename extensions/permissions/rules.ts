// 规则式权限（第 14 章），Pi 扩展和 mox 扩展共用。
// 规则语法与 Claude Code 一致：Tool 或 Tool(说明符)，按 deny → ask → allow 的顺序判断，都不匹配时由模式决定。
//   https://code.claude.com/docs/en/permissions
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export type Behavior = 'allow' | 'ask' | 'deny';
export type Mode = 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions';
export const MODES: Mode[] = ['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions'];

export interface Rule { behavior: Behavior; text: string; tool: string; spec?: string; /** 规则所在配置文件对应的目录：/path 形式的路径以它为基准 */ base: string }
export interface Decision { behavior: Behavior; reason: string; rule?: string }
export interface PermissionContext {
  cwd: string; mode: Mode; rules: Rule[]; additionalDirectories?: string[]; home?: string;
  /** 声明了不改变外部环境的工具（扩展用 annotations.readOnlyHint 声明）。MCP 工具的声明来自服务器，不在此列 */
  readOnlyTools?: Set<string>;
}

// ── 读取配置 ──────────────────────────────────────────

export function parseRule(text: string, behavior: Behavior, base: string): Rule {
  const m = text.trim().match(/^([^(]+?)(?:\((.*)\))?$/s);
  const tool = m?.[1].trim() ?? text;
  const spec = m?.[2] === undefined || m[2] === '*' ? undefined : m[2];   // Bash(*) 等同于 Bash
  return { behavior, text, tool, spec, base };
}

/** 配置格式：{ "permissions": { "allow": [], "ask": [], "deny": [], "defaultMode": "...", "additionalDirectories": [] } } */
export function loadPermissionSettings(files: { path: string; base: string }[]) {
  const rules: Rule[] = [];
  let defaultMode: Mode | undefined;
  const additionalDirectories: string[] = [];
  const errors: string[] = [];
  for (const { path, base } of files) {
    if (!existsSync(path)) continue;
    try {
      const p = JSON.parse(readFileSync(path, 'utf8')).permissions ?? {};
      for (const behavior of ['deny', 'ask', 'allow'] as const) for (const text of p[behavior] ?? []) rules.push(parseRule(text, behavior, base));
      if (p.defaultMode) defaultMode = p.defaultMode;
      for (const d of p.additionalDirectories ?? []) additionalDirectories.push(resolve(base, d));
    } catch (error) { errors.push(`${path}：${(error as Error).message}`); }
  }
  return { rules, defaultMode, additionalDirectories, errors };
}

// ── Bash：拆分复合命令 ─────────────────────────────────

/**
 * 按 &&、||、;、|、|&、& 和换行拆成子命令（引号里的不算）。$(…)、`…` 和 ( … ) 里的命令同样会执行，也要拿出来检查。
 * 返回 ok: false 表示没法可靠地解析（比如 `npm test &&` 后面什么都没有），这时不能自动放行。
 */
export function splitCommand(command: string): { commands: string[]; ok: boolean } {
  const commands: string[] = [];
  let ok = true;
  let current = '';
  let quote: '"' | "'" | null = null;
  const flush = () => { if (current.trim()) commands.push(current.trim()); current = ''; };
  /** 从 start（左括号之后）找到匹配的右括号 */
  const balanced = (start: number, open: string, close: string) => {
    let depth = 1;
    let i = start;
    let q: string | null = null;
    for (; i < command.length && depth > 0; i++) {
      const c = command[i];
      if (q) { if (c === q) q = null; else if (c === '\\' && q === '"') i++; continue; }
      if (c === "'" || c === '"') q = c;
      else if (c === open) depth++;
      else if (c === close) depth--;
    }
    if (depth > 0) ok = false;
    return i;                                    // 右括号之后的位置
  };
  const nested = (inner: string) => { const r = splitCommand(inner); commands.push(...r.commands); ok &&= r.ok; };

  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote === "'") { current += c; if (c === "'") quote = null; continue; }
    if (c === '\\') { current += c + (command[i + 1] ?? ''); i++; continue; }
    if (c === '$' && command[i + 1] === '(') { const end = balanced(i + 2, '(', ')'); nested(command.slice(i + 2, end - 1)); current += command.slice(i, end); i = end - 1; continue; }
    if (c === '`') { const end = command.indexOf('`', i + 1); if (end < 0) { ok = false; break; } nested(command.slice(i + 1, end)); current += command.slice(i, end + 1); i = end; continue; }
    if (quote === '"') { current += c; if (c === '"') quote = null; continue; }
    if (c === "'" || c === '"') { quote = c; current += c; continue; }
    if (c === '(' && !current.trim()) { const end = balanced(i + 1, '(', ')'); nested(command.slice(i + 1, end - 1)); i = end - 1; continue; }
    const two = command.slice(i, i + 2);
    if (two === '&&' || two === '||' || two === '|&') {
      flush(); i++;
      if (!command.slice(i + 1).trim()) ok = false;
      continue;
    }
    if (c === ';' || c === '|' || c === '\n' || (c === '&' && command[i - 1] !== '>' && command[i + 1] !== '>')) { flush(); continue; }
    current += c;
  }
  if (quote) ok = false;
  flush();
  return { commands, ok };
}

/** 按 shell 的规则切分单词，保留每个单词在原文中的起点（去掉包装命令时要切原文，而不是拼接单词）。 */
function words(command: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  const re = /(?:'[^']*'|"(?:\\.|[^"])*"|\\.|[^\s'"\\])+/g;
  for (const m of command.matchAll(re)) out.push({ text: m[0].replace(/^(['"])(.*)\1$/s, '$2'), start: m.index! });
  return out;
}

const SAFE_ENV = new Set(['NODE_ENV', 'CI', 'DEBUG', 'FORCE_COLOR', 'NO_COLOR', 'LANG', 'LC_ALL', 'TZ']);

/**
 * 去掉不改变“实际执行什么”的前缀：环境变量赋值，以及 timeout、time、nice、nohup、stdbuf、command、builtin、不带参数的 xargs。
 * forAllow 为真时，只去掉已知安全的环境变量——`PATH=/tmp/evil npm test` 不该被 Bash(npm test *) 放行。
 */
export function stripWrappers(command: string, forAllow: boolean): string {
  const w = words(command);
  let k = 0;
  while (k < w.length) {
    const t = w[k].text;
    const assign = t.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (assign) { if (forAllow && !SAFE_ENV.has(assign[1])) break; k++; continue; }
    if (['time', 'nohup', 'builtin', 'noglob'].includes(t) || (t === 'command' && w[k + 1]?.text !== '-v')) { k++; continue; }
    if (t === 'nice') { k++; if (w[k]?.text === '-n') k += 2; else if (/^-\d+$/.test(w[k]?.text ?? '')) k++; continue; }
    if (t === 'timeout') { k++; while (w[k]?.text.startsWith('-')) k++; k++; continue; }
    if (t === 'stdbuf') { k++; while (w[k]?.text.startsWith('-')) k++; continue; }
    if (t === 'xargs' && w[k + 1] && !w[k + 1].text.startsWith('-')) { k++; continue; }
    break;
  }
  return k < w.length ? command.slice(w[k].start).trim() : '';
}

/** Bash(说明符) 的通配：* 匹配任意文本；结尾的“ *”（或 :*）同时匹配不带参数的命令。 */
export function matchBashPattern(pattern: string, command: string): boolean {
  const p = pattern.endsWith(':*') ? `${pattern.slice(0, -2)} *` : pattern;
  const toRe = (s: string) => new RegExp(`^${s.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 's');
  if (toRe(p).test(command)) return true;
  return p.endsWith(' *') && p.indexOf('*') === p.length - 1 && command === p.slice(0, -2);
}

// ── 只读命令 ───────────────────────────────────────────

const READ_ONLY = new Set(['ls', 'cat', 'echo', 'pwd', 'head', 'tail', 'grep', 'rg', 'wc', 'which', 'diff', 'stat', 'du', 'file', 'tree', 'cd', 'true', 'date', 'whoami', 'sort', 'uniq']);
const READ_ONLY_GIT = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'blame']);
/** 这些命令的非选项参数是要读的文件：Read 的 deny 规则对它们同样生效 */
const FILE_READERS = new Set(['cat', 'head', 'tail', 'less', 'more', 'wc', 'diff', 'stat', 'file', 'sort', 'uniq']);

function isReadOnly(command: string): boolean {
  const w = words(command).map(x => x.text);
  // 输出重定向就是写文件（> /dev/null 和 2>&1 这类不算）
  for (const m of command.replace(/'[^']*'|"[^"]*"/g, '""').matchAll(/(?<![<>&])\d?>>?\s*(&?[^\s;|&]+)/g)) {
    if (m[1] !== '/dev/null' && !m[1].startsWith('&')) return false;
  }
  if (w[0] === 'git') return READ_ONLY_GIT.has(w[1] ?? '') && !w.some(x => x === '--output' || x.startsWith('--output='));
  if (w[0] === 'find') return !w.some(x => ['-exec', '-execdir', '-delete', '-ok', '-fprint', '-fprintf', '-fls'].includes(x));
  if (w[0] === 'sort') return !w.some(x => x === '-o' || x.startsWith('--output'));
  return READ_ONLY.has(w[0] ?? '');
}

// ── 路径规则 ───────────────────────────────────────────

/**
 * 尽量解析成真实路径：文件还不存在时（比如要新建的文件），解析最近的存在的上级目录，再拼上剩下的部分。
 * macOS 上 /var 是 /private/var 的符号链接，不统一解析的话，同一个文件会被当成两个不同的路径。
 */
export function realish(p: string): string {
  try { return realpathSync(p); } catch {
    const parent = dirname(p);
    return parent === p ? p : join(realish(parent), basename(p));
  }
}

function globToRegex(glob: string): string {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += glob[i + 2] === '/' ? 2 : 1; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return re;
}

/**
 * gitignore 风格的路径匹配。锚点：//path 从根目录；~/path 从家目录；/path 从规则所在配置文件对应的目录；其他从当前目录。
 * 不含斜杠的模式（.env、*.pem）匹配锚点之下任意深度。
 */
export function matchPath(spec: string, file: string, ctx: { cwd: string; base: string; home: string }): boolean {
  let anchor: string;
  let pattern: string;
  if (spec.startsWith('//')) { anchor = '/'; pattern = spec.slice(2); }
  else if (spec.startsWith('~/')) { anchor = ctx.home; pattern = spec.slice(2); }
  else if (spec.startsWith('/')) { anchor = ctx.base; pattern = spec.slice(1); }
  else { anchor = ctx.cwd; pattern = spec.replace(/^\.\//, ''); }
  const body = globToRegex(pattern.replace(/\/$/, ''));
  const re = pattern.includes('/') && !pattern.endsWith('/') ? new RegExp(`^${body}(?:/.*)?$`) : new RegExp(`^(?:.*/)?${body}(?:/.*)?$`);
  return [...new Set([anchor, realish(anchor)])].some(a => {
    const rel = relative(a, file).split(sep).join('/');
    return !rel.startsWith('..') && !isAbsolute(rel) && re.test(rel);
  });
}

/** 符号链接要解析到真实路径：.env 的软链接不能绕过 Read(.env)。两个路径都检查，任一匹配就算。 */
function candidates(file: string): string[] {
  const real = realish(file);
  return real === file ? [file] : [file, real];
}

function insideWorkingDirs(file: string, ctx: PermissionContext): boolean {
  return [ctx.cwd, ...(ctx.additionalDirectories ?? [])].some(dir => {
    const rel = relative(realish(dir), realish(file));
    return !rel.startsWith('..') && !isAbsolute(rel);
  });
}

// ── 判断一次工具调用 ───────────────────────────────────

const CLAUDE_NAME: Record<string, string> = { bash: 'Bash', read: 'Read', write: 'Write', edit: 'Edit', grep: 'Grep', find: 'Glob', ls: 'LS', web_fetch: 'WebFetch' };
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS']);
/** 本身没有外部效果、只是去调用别的工具的“容器”：codemode 脚本、工具搜索、子 Agent（第 15、17 章） */
const META_TOOLS = new Set(['codemode', 'tool_search', 'agent']);

/** 工具名规则：精确匹配；mcp__服务器 匹配这个服务器的全部工具；* 通配。 */
function matchToolName(ruleTool: string, tool: string): boolean {
  if (ruleTool === tool) return true;
  if (/^mcp__[^_]+(?:[^_]|_(?!_))*$/.test(ruleTool) && tool.startsWith(`${ruleTool}__`)) return true;
  return ruleTool.includes('*') && new RegExp(`^${ruleTool.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(tool);
}

/** 一条规则是否匹配这次调用。Bash 由调用方按子命令处理。 */
function ruleMatches(rule: Rule, tool: string, input: Record<string, any>, ctx: PermissionContext): boolean {
  const home = ctx.home ?? homedir();
  const path = (p: string) => (isAbsolute(p) ? p : resolve(ctx.cwd, p));
  if (rule.spec === undefined) return matchToolName(rule.tool, tool);
  if (rule.tool === 'Read' && (READ_TOOLS.has(tool) || ((tool === 'Edit' || tool === 'Write') && rule.behavior === 'deny'))) {
    // Read 的 deny 也挡住对同一路径的 Edit / Write：不能读的文件，也不该能改
    const target = input.path ?? input.file_path;
    return typeof target === 'string' && candidates(path(target)).some(f => matchPath(rule.spec!, f, { cwd: ctx.cwd, base: rule.base, home }));
  }
  if (rule.tool === 'Edit' && (tool === 'Edit' || tool === 'Write')) {
    const target = input.path ?? input.file_path;   // mox / Pi 的工具叫 path，Claude Code 的叫 file_path
    return typeof target === 'string' && candidates(path(target)).some(f => matchPath(rule.spec!, f, { cwd: ctx.cwd, base: rule.base, home }));
  }
  if (rule.tool === 'WebFetch' && tool === 'WebFetch' && rule.spec.startsWith('domain:')) {
    try { const host = new URL(input.url).hostname; const d = rule.spec.slice(7); return host === d || (d.startsWith('*.') && host.endsWith(d.slice(1))); } catch { return false; }
  }
  return false;
}

const decide = (behavior: Behavior, reason: string, rule?: Rule): Decision => ({ behavior, reason, ...(rule ? { rule: rule.text } : {}) });

export function decidePermission(toolName: string, input: Record<string, any>, ctx: PermissionContext): Decision {
  const tool = CLAUDE_NAME[toolName] ?? toolName;
  // 哪些规则和这次调用有关：同名工具的规则；Read 的路径规则也管 Grep、Glob、LS，它的 deny 还管 Edit、Write；Edit 的路径规则也管 Write
  const byBehavior = (b: Behavior) => ctx.rules.filter(r => r.behavior === b && (
    matchToolName(r.tool, tool)
    || (r.tool === 'Read' && r.spec !== undefined && (READ_TOOLS.has(tool) || (b === 'deny' && (tool === 'Edit' || tool === 'Write'))))
    || (r.tool === 'Edit' && r.spec !== undefined && tool === 'Write')));
  const home = ctx.home ?? homedir();

  if (tool === 'Bash') return decideBash(String(input.command ?? ''), ctx, byBehavior, home);

  for (const b of ['deny', 'ask'] as const) {
    const rule = byBehavior(b).find(r => ruleMatches(r, tool, input, ctx));
    if (rule && b === 'deny') return decide('deny', `被规则 ${rule.text} 禁止`, rule);
    if (rule) return modeGate(ctx, tool, decide('ask', `规则 ${rule.text} 要求确认`, rule), READ_TOOLS.has(tool), true);
  }
  const allow = byBehavior('allow').find(r => ruleMatches(r, tool, input, ctx));
  if (allow) return modeGate(ctx, tool, decide('allow', `规则 ${allow.text} 允许`, allow), READ_TOOLS.has(tool));

  // codemode、tool_search、子 Agent 本身没有副作用：它们发起的每个工具调用都会单独经过这里的检查。检查效果，不检查容器
  if (META_TOOLS.has(tool)) return decide('allow', '它本身没有副作用，脚本里的每次工具调用会单独检查');
  if (ctx.readOnlyTools?.has(toolName)) return decide('allow', '工具声明了不改变外部环境');

  const target = input.path ?? input.file_path;
  const inside = typeof target !== 'string' || insideWorkingDirs(resolve(ctx.cwd, target), ctx);
  if (READ_TOOLS.has(tool)) return modeGate(ctx, tool, inside ? decide('allow', '只读操作，在工作目录内') : decide('ask', `读取工作目录之外的路径：${target}`), true);
  if (tool === 'Edit' || tool === 'Write') {
    if (ctx.mode === 'acceptEdits' && inside) return decide('allow', 'acceptEdits 模式：自动接受工作目录内的修改');
    return modeGate(ctx, tool, decide('ask', inside ? '修改文件需要确认' : `修改工作目录之外的文件：${target}`), false);
  }
  return modeGate(ctx, tool, decide('ask', `${tool} 需要确认`), false);
}

/** 模式最后把关：plan 只许读；dontAsk 把“问”变成“拒”；bypassPermissions 把“问”变成“允许”（deny 规则仍然有效）。 */
function modeGate(ctx: PermissionContext, tool: string, d: Decision, readOnly: boolean, fromRule = false): Decision {
  if (ctx.mode === 'plan' && !readOnly) return decide('deny', `计划模式：只能读，不能执行 ${tool}`);
  if (d.behavior !== 'ask') return d;
  if (ctx.mode === 'dontAsk') return decide('deny', `${d.reason}（dontAsk 模式：不询问，直接拒绝）`);
  if (ctx.mode === 'bypassPermissions' && !fromRule) return decide('allow', 'bypassPermissions 模式');   // 用户明确写的 ask 规则仍然要问
  return d;
}

function decideBash(command: string, ctx: PermissionContext, byBehavior: (b: Behavior) => Rule[], home: string): Decision {
  const { commands, ok } = splitCommand(command);
  // deny / ask：任何一个子命令匹配就生效（包括 $(…) 里的）。匹配时去掉所有环境变量赋值和包装命令
  for (const b of ['deny', 'ask'] as const) {
    for (const sub of commands) {
      const plain = stripWrappers(sub, false);
      const rule = byBehavior(b).find(r => r.spec === undefined ? true : matchBashPattern(r.spec, plain));
      if (rule && b === 'deny') return decide('deny', `被规则 ${rule.text} 禁止：${sub}`, rule);
      if (rule) return modeGate(ctx, 'Bash', decide('ask', `规则 ${rule.text} 要求确认：${sub}`, rule), false, true);
      // 读文件的命令也要遵守 Read 的规则：cat .env 和 read .env 是一回事
      const w = words(plain).map(x => x.text);
      if (FILE_READERS.has(w[0] ?? '')) {
        for (const arg of w.slice(1).filter(a => !a.startsWith('-'))) {
          const readRule = ctx.rules.find(r => r.behavior === b && r.tool === 'Read' && r.spec !== undefined && candidates(resolve(ctx.cwd, arg)).some(f => matchPath(r.spec!, f, { cwd: ctx.cwd, base: r.base, home })));
          if (readRule && b === 'deny') return decide('deny', `${sub} 会读取 ${arg}，被规则 ${readRule.text} 禁止`, readRule);
          if (readRule) return modeGate(ctx, 'Bash', decide('ask', `${sub} 会读取 ${arg}，规则 ${readRule.text} 要求确认`, readRule), false, true);
        }
      }
    }
  }
  // allow：每一个子命令都要被允许（匹配 allow 规则，或者是只读命令）
  const pending = commands.filter(sub => {
    const plain = stripWrappers(sub, true);
    if (byBehavior('allow').some(r => r.spec === undefined || matchBashPattern(r.spec, plain))) return false;
    return !isReadOnly(stripWrappers(sub, false));
  });
  const readOnly = ok && commands.every(sub => isReadOnly(stripWrappers(sub, false)));
  if (ok && pending.length === 0) return modeGate(ctx, 'Bash', decide('allow', readOnly ? '只读命令' : '每个子命令都被规则允许'), readOnly);
  return modeGate(ctx, 'Bash', decide('ask', ok ? `需要确认：${pending.join('；')}` : '命令无法可靠解析，需要确认'), false);
}

/** 用户选择“本会话都允许”时生成的规则：Bash 按每个需要确认的子命令各存一条；文件修改限定在工作目录内。 */
export function suggestRules(toolName: string, input: Record<string, any>, ctx: PermissionContext): string[] {
  const tool = CLAUDE_NAME[toolName] ?? toolName;
  if (tool === 'Edit' || tool === 'Write') return ['Edit(/**)'];        // 基准目录是 cwd：只覆盖工作目录内的修改
  if (tool !== 'Bash') return [tool];
  return splitCommand(String(input.command ?? '')).commands
    .map(sub => stripWrappers(sub, true))
    .filter(sub => decideBash(sub, ctx, b => ctx.rules.filter(r => r.behavior === b && r.tool === 'Bash'), ctx.home ?? homedir()).behavior !== 'allow')
    .slice(0, 5)
    .map(sub => `Bash(${sub})`);
}

/** 整个工具被 deny（没有说明符的规则）：这些工具应该从模型能看到的工具列表里去掉，而不是等它调用时再拒绝。 */
export function deniedTools(toolNames: string[], rules: Rule[]): string[] {
  return toolNames.filter(name => rules.some(r => r.behavior === 'deny' && r.spec === undefined && matchToolName(r.tool, CLAUDE_NAME[name] ?? name)));
}
