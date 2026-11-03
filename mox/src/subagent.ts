// 子 Agent（第 17 章）：把一个能独立完成的子任务交给另一个 Agent 循环。
// 子 Agent 从空白的上下文开始，只看得到父 Agent 写的任务说明；它读过的文件、跑过的命令都留在自己的上下文里，
// 交回给父 Agent 的只有最后的结论。这是在用上下文换上下文：花子 Agent 的 token，保护主对话的上下文。
// 实现方式：在同一个进程里再跑一次第 3 章的 runLoop。对照 Pi 的示例（examples/extensions/subagent），它为每个子 Agent 启动一个 pi 进程。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runLoop } from './loop.ts';
import { parseFrontmatter } from './skills.ts';
import type { AgentTool, ToolHooks } from './tools.ts';
import type { Model } from './types.ts';

export interface AgentDefinition { name: string; description: string; tools?: string[]; systemPrompt: string; source: string }

export const BUILTIN_AGENTS: AgentDefinition[] = [
  {
    name: 'explore',
    description: '只读地搜索和阅读代码，回答“X 在哪里、是怎么工作的”这类问题。返回结论和精确的文件位置，不返回大段代码。',
    tools: ['read', 'bash'],
    source: 'builtin',
    systemPrompt: [
      '你是一个负责调研的子 Agent。你的结论会交给另一个没有看过这些文件的 Agent。',
      '只读：不要修改任何文件，bash 只用来搜索（grep、find、ls）。',
      '先用搜索定位，再读关键的片段，不要整份文件地读。',
      '最后的回答要短：结论、关键的文件和行号、它们之间的关系。不要复述你读过的代码。',
    ].join('\n'),
  },
  {
    name: 'general',
    description: '通用的子 Agent，可以读写文件、执行命令。适合可以独立完成、做完只需要汇报结果的子任务。',
    source: 'builtin',
    systemPrompt: '你是一个子 Agent，负责独立完成交给你的任务。做完后简要汇报：做了什么、改了哪些文件、有没有遗留的问题。',
  },
];

/** 自定义子 Agent：一个 Markdown 文件，元信息里写 name、description、tools（逗号分隔），正文是系统提示。 */
export function loadAgents(dirs: string[]): AgentDefinition[] {
  const agents: AgentDefinition[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
      const { data, body } = parseFrontmatter(readFileSync(join(dir, file), 'utf8'));
      if (!data.name || !data.description || agents.some(a => a.name === data.name)) continue;
      agents.push({ name: data.name, description: data.description, tools: data.tools?.split(',').map(t => t.trim()).filter(Boolean), systemPrompt: body.trim(), source: join(dir, file) });
    }
  }
  return agents;
}

export interface SubagentOptions {
  model: Model;
  /** 父 Agent 当前的全部工具。子 Agent 从中挑选，并且拿不到 agent 工具本身（不允许嵌套） */
  tools: () => AgentTool[];
  /** 父 Agent 的工具钩子：权限规则、钩子同样作用于子 Agent 的每一次工具调用 */
  hooks?: ToolHooks;
  agents: AgentDefinition[];
  cwd: string;
  maxConcurrency?: number;
  maxTurns?: number;
}

export interface SubagentResult { agent: string; task: string; ok: boolean; output: string; turns: number; toolCalls: number; input: number; output_tokens: number; contextChars: number }

const MAX_TASKS = 8;
const MAX_OUTPUT = 50 * 1024;

/** 有并发上限的并行执行：同时最多跑 limit 个，结果按任务顺序返回 */
export async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function runSubagent(def: AgentDefinition, task: string, options: SubagentOptions, signal?: AbortSignal): Promise<SubagentResult> {
  const tools = options.tools().filter(t => t.name !== 'agent' && (!def.tools || def.tools.includes(t.name)));
  const systemPrompt = `${def.systemPrompt}\n\n工作目录：${options.cwd}\n可用的工具：${tools.map(t => t.name).join('、')}`;
  let toolCalls = 0;
  const { messages, reason } = await runLoop([], [{ role: 'user', content: task }], {
    model: options.model, systemPrompt, tools, hooks: options.hooks, signal,
    onEvent: e => { if (e.type === 'tool_start') toolCalls++; },
    // 防止子 Agent 无限地做下去
    finishTurn: ({ turn }) => (turn >= (options.maxTurns ?? 30) ? 'end' : undefined),
  });
  const assistants = messages.filter(m => m.role === 'assistant');
  const last = assistants.at(-1);
  const text = last?.role === 'assistant' ? last.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('').trim() : '';
  const ok = reason !== 'error' && reason !== 'aborted' && text.length > 0;
  return {
    agent: def.name, task, ok,
    output: ok ? text : `子 Agent 没有完成（${reason}）${last?.role === 'assistant' && last.errorMessage ? `：${last.errorMessage}` : ''}`,
    turns: assistants.length, toolCalls,
    input: assistants.reduce((n, m) => n + (m.role === 'assistant' ? m.usage.input + (m.usage.cacheRead ?? 0) : 0), 0),
    output_tokens: assistants.reduce((n, m) => n + (m.role === 'assistant' ? m.usage.output : 0), 0),
    contextChars: JSON.stringify(messages).length,
  };
}

export function createAgentTool(options: SubagentOptions): AgentTool {
  const job = { type: 'object', properties: { agent: { type: 'string' }, task: { type: 'string' } }, required: ['agent', 'task'] };
  return {
    name: 'agent',
    description: [
      '把一个能独立完成的子任务交给子 Agent。',
      '子 Agent 看不到这段对话，只能看到你写的 task：要写清楚背景、目标、已经知道和排除了什么，以及要它返回什么。',
      '它只把最后的结论交回来，中间读过的文件不会进入你的上下文——适合“需要翻很多文件，但只要一个结论”的调研。',
      `多个互不依赖的任务可以放进 tasks 并行执行（最多 ${MAX_TASKS} 个）。简单的、一两次工具调用就能完成的事，自己做更快。`,
      '',
      '可用的子 Agent：',
      ...options.agents.map(a => `- ${a.name}：${a.description}`),
    ].join('\n'),
    parameters: { type: 'object', properties: { ...job.properties, tasks: { type: 'array', items: job, description: '并行执行的多个任务' } } } as AgentTool['parameters'],
    async execute(args, { signal }) {
      const jobs: { agent: string; task: string }[] = args.tasks?.length ? args.tasks : args.agent && args.task ? [{ agent: args.agent, task: args.task }] : [];
      if (!jobs.length) return { content: '需要 agent 和 task，或者 tasks 数组', isError: true };
      if (jobs.length > MAX_TASKS) return { content: `一次最多 ${MAX_TASKS} 个任务`, isError: true };
      const unknown = jobs.find(j => !options.agents.some(a => a.name === j.agent));
      if (unknown) return { content: `没有名为 ${unknown.agent} 的子 Agent。可用的：${options.agents.map(a => a.name).join('、')}`, isError: true };
      const results = await mapWithLimit(jobs, options.maxConcurrency ?? 4, j => runSubagent(options.agents.find(a => a.name === j.agent)!, j.task, options, signal));
      const content = results.map(r => {
        const body = r.output.length > MAX_OUTPUT ? `${r.output.slice(0, MAX_OUTPUT)}\n[输出过长，已截断]` : r.output;
        return results.length > 1 ? `## ${r.agent}：${r.task.slice(0, 40)}${r.ok ? '' : '（失败）'}\n${body}` : body;
      }).join('\n\n');
      return { content, isError: results.every(r => !r.ok) || undefined, details: results };
    },
  };
}
