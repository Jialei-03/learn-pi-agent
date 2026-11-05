// 第 3 章：五个情形的模型脚本与虚拟文件系统。
// 同一份脚本驱动三种实现：朴素循环 v0、mox 的 runLoop、Pi 的 runAgentLoop。
import type { Tool } from '../../mox/src/loop.ts';
import type { Msg } from '../../mox/src/model.ts';
import type { Script } from '../shared/scripted.ts';

export const SAFETY_CAP = 8;                                   // 演示用：超过这么多次请求就判定“停不下来”
const README = '# Mox Notes\n一个命令行笔记工具。\n';
const INSTALL = '## 安装\n1. 克隆仓库\n2. 运行 npm install\n';

/** 最近一条工具结果；mox 的工具消息没有 isError，失败的结果以“错误：”开头。 */
export const lastResult = (messages: Msg[]) => messages.findLast(m => m.role === 'tool');
export const isFailure = (m?: Msg) => !!m && typeof m.content === 'string' && m.content.startsWith('错误：');

export interface Scenario {
  title: string;
  prompt: string;
  script: Script;
  stopAfter?: number;         // 宿主的停止策略：累计这么多轮之后叫停
  interjection?: string;      // 第一次工具执行期间，用户插入的一句话
}

export const scenarios: Record<string, Scenario> = {
  success: {
    title: '成功路径：读文件再回答',
    prompt: '读取 README.md，告诉我这个项目是做什么的。',
    script: (messages, n) => n === 1
      ? { toolCalls: [{ id: `read-${n}`, name: 'read', arguments: { path: 'README.md' } }] }
      : { text: '项目说明：' + lastResult(messages)!.content.split('\n')[1] },
  },
  truncated: {
    title: '输出截断：写文件的参数只生成了一半',
    prompt: '写一份 INSTALL.md。',
    script: (messages, n) => {
      if (n === 1) return { toolCalls: [{ id: `write-${n}`, name: 'write', arguments: { path: 'INSTALL.md', content: INSTALL.slice(0, 12) } }], finish: 'length' };
      if (n === 2 && isFailure(lastResult(messages))) return { toolCalls: [{ id: `write-${n}`, name: 'write', arguments: { path: 'INSTALL.md', content: INSTALL } }] };
      return { text: '已写入 INSTALL.md。' };
    },
  },
  missing: {
    title: '工具失败：要读的文件不存在',
    prompt: '读取 absent.md。',
    script: (_messages, n) => n === 1
      ? { toolCalls: [{ id: `read-${n}`, name: 'read', arguments: { path: 'absent.md' } }] }
      : { text: '没有找到 absent.md。目录里只有 README.md，要改读它吗？' },
  },
  runaway: {
    title: '停不下来：模型每一轮都想“再确认一次”',
    prompt: '确认 README.md 的内容没有变化。',
    stopAfter: 3,
    script: (_messages, n) => ({ toolCalls: [{ id: `read-${n}`, name: 'read', arguments: { path: 'README.md' } }] }),
  },
  steer: {
    title: '中途插话：读文件期间用户补了一句“只用一句话”',
    prompt: '介绍一下这个项目。',
    interjection: '只用一句话回答。',
    script: (messages, n) => {
      if (n === 1) return { toolCalls: [{ id: `read-${n}`, name: 'read', arguments: { path: 'README.md' } }] };
      const short = messages.some(m => m.role === 'user' && m.content.includes('一句话'));
      return { text: short ? 'Mox Notes 是一个命令行笔记工具。' : 'Mox Notes 是一个命令行笔记工具。它可以记录想法、按关键词搜索……（长篇介绍）' };
    },
  },
};

/** 每个情形都从同一份虚拟文件系统开始，不碰真实磁盘。工具的形状和 mox 的 read / write 一样。 */
export function createWorld(scenario: Scenario) {
  const files: Record<string, string> = { 'README.md': README };
  const toolRuns: string[] = [];
  const steering: string[] = [];
  const tools: Tool[] = [
    {
      name: 'read', description: '读取文件', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      run({ path }) {
        toolRuns.push(`read ${path}`);
        if (scenario.interjection && toolRuns.length === 1) steering.push(scenario.interjection);
        if (!(path in files)) throw new Error(`ENOENT: ${path} 不存在`);
        return files[path];
      },
    },
    {
      name: 'write', description: '写入文件', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      run({ path, content }) {
        toolRuns.push(`write ${path}`);
        files[path] = content;
        return `写入 ${content.length} 个字符`;
      },
    },
  ];
  return { files, toolRuns, steering, tools };
}

export interface Observation { requests: number; toolRuns: string[]; outcome: string; install?: string; unread: string[] }
