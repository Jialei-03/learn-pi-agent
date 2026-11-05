// 第 17 章的参考实现：用扩展给 mox 加“命名的子 Agent”。
// mox 内置的 task 只有一种子 Agent（空白上下文、全部工具）。Pi 和 Claude Code 允许自己定义：
// 一个 Markdown 文件，frontmatter 里写 name、description、tools，正文是系统提示。这里用 registerTool 做出同样的东西，
// 并且补上 mox 没有的两样：每个子 Agent 只拿到定义里列出的工具，以及有并发上限的并行（tasks 数组）。
// 用法：mox -e labs/ch17/agents.ts，定义文件放在 ~/.mox/agents/*.md
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runLoop, type Tool } from '../../mox/src/loop.ts';
import { openai, type Model } from '../../mox/src/model.ts';
import type { Extension } from '../../mox/src/extensions.ts';
import { codingTools } from '../../mox/src/tools.ts';

const READ_ONLY = new Set(['read', 'grep', 'find', 'ls']);         // 这几个工具没有副作用，不需要审批

export type AgentDef = { name: string; description: string; tools: string[]; prompt: string };

/** 目录里的 .md 文件，frontmatter 写 name、description、tools（逗号分隔），正文是系统提示。 */
export function loadAgents(dirs: string[]): AgentDef[] {
  const agents: AgentDef[] = [];
  for (const dir of dirs.filter(existsSync)) {
    for (const file of readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
      const [, meta = '', body = ''] = readFileSync(join(dir, file), 'utf8').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/) ?? [];
      const field = (key: string) => meta.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1].trim();
      const name = field('name'), description = field('description');
      if (!name || !description || agents.some(a => a.name === name)) continue;
      agents.push({ name, description, tools: (field('tools') ?? 'read').split(',').map(t => t.trim()).filter(Boolean), prompt: body.trim() });
    }
  }
  return agents;
}

/** 有并发上限的并行：同时最多跑 limit 个，结果按任务顺序排列，不按完成顺序。 */
export async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; results[i] = await fn(items[i]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export type AgentsOptions = {
  dirs?: string[];
  model?: Model;
  /** 同时最多几个子 Agent */
  limit?: number;
  /** 子 Agent 要用 read 以外的工具时的审批。默认用 mox.ask 问用户；没有终端就拒绝 */
  approve?: (agent: string, tool: string, args: unknown) => Promise<boolean>;
};

export function agentsExtension(options: AgentsOptions = {}): Extension {
  return mox => {
    const agents = loadAgents(options.dirs ?? [join(homedir(), '.mox', 'agents')]);
    const model = options.model ?? openai({ baseUrl: process.env.MOX_BASE_URL, apiKey: process.env.MOX_API_KEY, model: process.env.MOX_MODEL });
    const approve = options.approve ?? (async (agent, tool, args) => (await mox.ask(`子 Agent ${agent} 想用 ${tool} ${JSON.stringify(args).slice(0, 80)}，允许吗？`, ['允许', '拒绝'])) === '允许');

    /** 定义里列出的工具；除了只读的那几个，每次调用都要先过审批。扩展拿不到 cli.ts 的 beforeTool，所以子 Agent 的把关要在这里重做一遍 */
    const toolsFor = (def: AgentDef): Tool[] => codingTools(mox.cwd).filter(t => def.tools.includes(t.name)).map(t =>
      READ_ONLY.has(t.name) ? t : { ...t, run: async (args, signal) => { if (!(await approve(def.name, t.name, args))) throw new Error('用户拒绝了这次调用'); return t.run(args, signal); } });

    const runAgent = (name: string, prompt: string, signal?: AbortSignal) => {
      const def = agents.find(a => a.name === name);
      if (!def) throw new Error(`没有名为 ${name} 的子 Agent。可用的：${agents.map(a => a.name).join('、')}`);
      return runLoop([{ role: 'user', content: prompt }], { model, system: `${def.prompt}\n\n工作目录：${mox.cwd}`, tools: toolsFor(def), signal });
    };

    const job = { type: 'object', properties: { agent: { type: 'string' }, prompt: { type: 'string' } }, required: ['agent', 'prompt'] };
    mox.registerTool({
      name: 'agent',
      description: [
        '把一个独立的子任务交给指定的子 Agent。它看不到当前对话，prompt 要写清背景和要返回什么；只交回最终结论。',
        '互不依赖的多个任务可以放进 tasks 并行执行。',
        '可用的子 Agent：',
        ...agents.map(a => `- ${a.name}：${a.description}`),
      ].join('\n'),
      parameters: { type: 'object', properties: { ...job.properties, tasks: { type: 'array', items: job, description: '并行执行的多个任务' } } },
      run: async ({ agent, prompt, tasks }: { agent?: string; prompt?: string; tasks?: { agent: string; prompt: string }[] }, signal) => {
        const jobs = tasks?.length ? tasks : agent && prompt ? [{ agent, prompt }] : [];
        if (!jobs.length) throw new Error('需要 agent 和 prompt，或者 tasks 数组');
        const results = await mapWithLimit(jobs, options.limit ?? 3, j => runAgent(j.agent, j.prompt, signal).catch(e => { if (signal?.aborted) throw e; return `（失败）${(e as Error).message}`; }));
        return jobs.length === 1 ? results[0] : results.map((r, i) => `## ${jobs[i].agent}：${jobs[i].prompt.slice(0, 30)}\n${r}`).join('\n\n');
      },
    });
  };
}

export default agentsExtension();
