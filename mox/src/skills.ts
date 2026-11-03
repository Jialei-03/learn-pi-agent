// Skills 与提示模板（第 11 章）。
// Skill：一个目录，里面有 SKILL.md（开头写 name 和 description）以及它要用到的脚本、参考资料。
// 系统提示里只放目录（名字 + 描述 + 文件位置）；任务匹配时，模型用 read 工具读取全文——渐进式披露。
// 提示模板：一个 Markdown 文件就是一个 /命令，展开后作为用户消息发出。
// 对照 Pi：packages/coding-agent/src/core/skills.ts、prompt-templates.ts
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export interface Skill { name: string; description: string; filePath: string; baseDir: string; disableModelInvocation: boolean }
export interface Diagnostic { file: string; message: string }

/** 解析 Markdown 开头的 --- 元信息块（只支持一层的 key: value）。 */
export function parseFrontmatter(text: string): { data: Record<string, string>; body: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text };
  const data: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) data[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return { data, body: m[2] };
}

/** Agent Skills 规范：名字只能是小写字母、数字和连字符，最长 64；描述最长 1024。 */
function validate(name: string | undefined, description: string | undefined): string[] {
  const problems: string[] = [];
  if (!description) problems.push('缺少 description：模型无法判断什么时候该用它，不会加载');
  else if (description.length > 1024) problems.push('description 超过 1024 个字符');
  if (name && (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64)) problems.push(`name "${name}" 不符合规范（小写字母、数字、单个连字符，最长 64）`);
  return problems;
}

/**
 * 递归查找 SKILL.md。一个目录里有 SKILL.md，它就是一个 Skill，不再往下找——
 * 否则 Skill 自带的参考资料里如果碰巧有 SKILL.md（比如示例），也会被当成独立的 Skill。
 * 同名的 Skill 保留先发现的那个，并给出提示。
 */
export function loadSkills(dirs: string[]): { skills: Skill[]; diagnostics: Diagnostic[] } {
  const skills: Skill[] = [];
  const diagnostics: Diagnostic[] = [];
  const load = (path: string) => {
    const { data } = parseFrontmatter(readFileSync(path, 'utf8'));
    const name = data.name || basename(dirname(path));
    const problems = validate(data.name, data.description);
    if (!data.description) { diagnostics.push({ file: path, message: problems[0] }); return; }
    problems.forEach(message => diagnostics.push({ file: path, message }));
    if (skills.some(s => s.name === name)) { diagnostics.push({ file: path, message: `与已加载的 Skill "${name}" 重名，忽略` }); return; }
    skills.push({ name, description: data.description, filePath: path, baseDir: dirname(path), disableModelInvocation: data['disable-model-invocation'] === 'true' });
  };
  const visit = (dir: string) => {
    if (!existsSync(dir)) return;
    if (existsSync(join(dir, 'SKILL.md'))) return load(join(dir, 'SKILL.md'));
    for (const entry of readdirSync(dir).sort()) {
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      let isDirectory = false;
      try { isDirectory = statSync(join(dir, entry)).isDirectory(); } catch { continue; }   // 失效的符号链接：跳过
      if (isDirectory) visit(join(dir, entry));
    }
  };
  dirs.forEach(visit);
  return { skills, diagnostics };
}

/** 进入系统提示的目录。标了 disable-model-invocation 的不列出：它们只能由用户用 /skill:名字 显式调用。 */
export function formatSkillsIndex(skills: Skill[]): string {
  const visible = skills.filter(s => !s.disableModelInvocation);
  if (!visible.length) return '';
  return [
    '下面的 Skills 提供特定任务的详细指引。当任务与某个 Skill 的描述相符时，先用 read 读取它的文件，再按其中的指引去做。',
    'Skill 里提到的相对路径，以 SKILL.md 所在目录为基准。',
    '',
    ...visible.map(s => `- ${s.name}：${s.description}\n  位置：${s.filePath}`),
  ].join('\n');
}

/** /skill:名字 参数 —— 用户强制使用某个 Skill：直接把全文放进这条消息，不用等模型自己去读。 */
export function expandSkillCommand(text: string, skills: Skill[]): string {
  const m = text.match(/^\/skill:([^\s]+)(?:\s+([\s\S]*))?$/);
  const skill = m && skills.find(s => s.name === m[1]);
  if (!skill) return text;
  const body = parseFrontmatter(readFileSync(skill.filePath, 'utf8')).body.trim();
  const block = `<skill name="${skill.name}" location="${skill.filePath}">\n相对路径以 ${skill.baseDir} 为基准。\n\n${body}\n</skill>`;
  return m![2] ? `${block}\n\n${m![2].trim()}` : block;
}

// ── 提示模板 ──────────────────────────────────────────

export interface PromptTemplate { name: string; description: string; content: string }

export function loadTemplates(dir: string): PromptTemplate[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.md')).map(f => {
    const { data, body } = parseFrontmatter(readFileSync(join(dir, f), 'utf8'));
    return { name: f.slice(0, -3), description: data.description ?? body.trim().split('\n')[0], content: body.trim() };
  });
}

/** 按 shell 的习惯切分参数：支持引号。 */
export function parseArgs(text: string): string[] {
  return [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(m => m[1] ?? m[2] ?? m[3]);
}

/** $1、$2……第 n 个参数；$@ 或 $ARGUMENTS：全部参数；${1:-默认值}：没给时用默认值；${@:2}：从第 2 个开始的全部参数。 */
export function substituteArgs(content: string, args: string[]): string {
  const all = args.join(' ');
  return content.replace(/\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g, (_m, target, fallback, sliceStart, sliceLength, simple) => {
    if (target) return (target === '@' || target === 'ARGUMENTS' ? all : args[Number(target) - 1]) || fallback;
    if (sliceStart) { const start = Math.max(0, Number(sliceStart) - 1); return args.slice(start, sliceLength ? start + Number(sliceLength) : undefined).join(' '); }
    if (simple === '@' || simple === 'ARGUMENTS') return all;
    return args[Number(simple) - 1] ?? '';
  });
}

export function expandTemplate(text: string, templates: PromptTemplate[]): string {
  const m = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  const template = m && templates.find(t => t.name === m[1]);
  return template ? substituteArgs(template.content, parseArgs(m![2] ?? '')) : text;
}
