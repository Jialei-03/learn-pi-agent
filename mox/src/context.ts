// 上下文装配（第 5 章引入，第 6 章完善）。
// 系统提示由若干“命名小节”组成：每一节可以单独替换，方便会话中途只更新变化的部分（第 6 章）。
// 对照 Pi：packages/coding-agent/src/core/system-prompt.ts、resource-loader.ts
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Message, Tool, Usage } from './types.ts';

// ── 项目说明文件 ───────────────────────────────────────────────

/** 每个目录只取第一个存在的文件；AGENTS.md 是多家 Agent 的通用约定，CLAUDE.md 兼容 Claude Code 的习惯。 */
export const CONTEXT_FILE_NAMES = ['AGENTS.override.md', 'AGENTS.md', 'CLAUDE.md'];

export interface ContextFile { path: string; content: string }

function loadFromDir(dir: string): ContextFile | undefined {
  for (const name of CONTEXT_FILE_NAMES) {
    const path = join(dir, name);
    if (existsSync(path) && statSync(path).isFile()) return { path, content: readFileSync(path, 'utf8').replace(/^﻿/, '') };
  }
  return undefined;
}

/**
 * 收集项目说明：先是用户全局的（~/.mox），再从文件系统根目录一路到当前目录。
 * 顺序从“最通用”到“最具体”，模型读到后面的说明时，自然会把它当成对前面的细化。
 */
export function discoverContextFiles(cwd: string, globalDir = join(homedir(), '.mox')): ContextFile[] {
  const files: ContextFile[] = [];
  const global = loadFromDir(globalDir);
  if (global) files.push(global);
  const ancestors: ContextFile[] = [];
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const file = loadFromDir(dir);
    if (file && !files.some(f => f.path === file.path)) ancestors.unshift(file);
    if (dirname(dir) === dir) break;
  }
  return [...files, ...ancestors];
}

// ── 系统提示 ─────────────────────────────────────────────────

export interface PromptInput {
  cwd: string;
  tools: Tool[];
  contextFiles?: ContextFile[];
  /** 第 11 章：Skills 的目录（名字 + 描述 + 文件位置），正文按需读取 */
  skillsIndex?: string;
}

export type PromptSections = Record<string, string>;

/**
 * 按固定顺序生成小节。把最稳定的内容放在最前面：身份和规则几乎不变，项目说明偶尔变，工作目录随会话变。
 * 注意这里没有“当前时间”这类每次都变的内容——它会让整个前缀每次都不一样，提示缓存永远命中不了。
 */
export function buildPromptSections({ cwd, tools, contextFiles = [], skillsIndex }: PromptInput): PromptSections {
  const sections: PromptSections = {
    preamble: '你是 mox，一个在用户终端里工作的 coding agent。你通过工具读取、修改文件和执行命令来完成用户的任务。',
    tools: tools.map(t => `- ${t.name}：${t.description.split('。')[0]}`).join('\n'),
    rules: [
      '- 修改文件之前先用 read 读取它，不要凭记忆猜测文件内容。',
      '- 局部修改用 edit；只有新建文件或整体重写时才用 write。',
      '- 改完之后尽量运行测试或命令验证结果。',
      '- 回答简洁，说明你做了什么、还有什么没做。',
    ].join('\n'),
  };
  if (contextFiles.length) {
    sections.project_context = ['以下是项目里的说明文件，越靠后的越具体：', ...contextFiles.map(f => `<instructions path="${f.path}">\n${f.content.trim()}\n</instructions>`)].join('\n\n');
  }
  if (skillsIndex) sections.skills = skillsIndex;
  sections.cwd = cwd;
  return sections;
}

/** 把小节渲染成文本：除了开头一段，每一节都用同名标签包起来，模型能把后来的更新对应到原来的小节。 */
export function renderSections(sections: PromptSections): string {
  return Object.entries(sections).map(([name, text]) => (name === 'preamble' ? text : `<${name}>\n${text}\n</${name}>`)).join('\n\n');
}

/** 会话中途小节变了：只生成变化的部分。null 表示删除这一节。 */
export function diffSections(previous: PromptSections, current: PromptSections): Record<string, string | null> | undefined {
  const patch: Record<string, string | null> = {};
  for (const [name, text] of Object.entries(current)) if (previous[name] !== text) patch[name] = text;
  for (const name of Object.keys(previous)) if (!(name in current)) patch[name] = null;
  return Object.keys(patch).length ? patch : undefined;
}

export function renderPatch(patch: Record<string, string | null>): string {
  return Object.entries(patch).map(([name, text]) => (text === null ? `系统提示的「${name}」一节已删除。` : `系统提示的「${name}」一节已更新为：\n<${name}>\n${text}\n</${name}>`)).join('\n\n');
}

export async function buildSystemPrompt(input: PromptInput): Promise<string> {
  return renderSections(buildPromptSections({ ...input, contextFiles: input.contextFiles ?? discoverContextFiles(input.cwd) }));
}

// ── 估算上下文大小 ───────────────────────────────────────────

const CHARS_PER_TOKEN = 3.5;
export const estimateTextTokens = (text: string) => Math.ceil(text.length / CHARS_PER_TOKEN);

/**
 * 上下文有多大？最准的数字来自服务商：最近一次回复的 usage 记录了那一刻的真实 token 数。
 * 在它之后新增的消息还没被服务商数过，只能按字符数估算。两者相加，就是下一次请求的估计大小。
 * 对照 Pi：packages/ai/src/utils/estimate.ts
 */
export function estimateContextTokens(systemPrompt: string, messages: Message[]): { tokens: number; measured: number; estimated: number } {
  let lastUsage: { index: number; usage: Usage } | undefined;
  messages.forEach((m, index) => { if (m.role === 'assistant' && m.usage.input + m.usage.output > 0) lastUsage = { index, usage: m.usage }; });
  const measured = lastUsage ? lastUsage.usage.input + lastUsage.usage.output + lastUsage.usage.cacheRead + lastUsage.usage.cacheWrite : estimateTextTokens(systemPrompt);
  const trailing = messages.slice(lastUsage ? lastUsage.index + 1 : 0);
  const estimated = trailing.reduce((sum, m) => sum + estimateTextTokens(JSON.stringify(m)), 0);
  return { tokens: measured + estimated, measured, estimated };
}
