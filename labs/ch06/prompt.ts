// 第 6 章实验：Pi 真正发给模型的系统提示长什么样？mox 的呢？
//   node labs/ch06/prompt.ts
// Pi 的 buildSystemPrompt 不是公开 API，这里按文件路径导入它的构建产物，只用于阅读。
// 工具的一句话说明和使用规则，取自 Pi 四个默认工具各自的 promptSnippet / promptGuidelines。
import { createBashTool, createEditTool, createReadTool, createWriteTool } from '@earendil-works/pi-coding-agent';
import { buildSystemPrompt } from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js';
import { createCodingTools } from '../../mox/src/coding/index.ts';
import { buildPromptSections, renderSections } from '../../mox/src/context.ts';
import { createEditToolDefinition } from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/edit.js';
import { createReadToolDefinition } from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/read.js';
import { createBashToolDefinition } from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/bash.js';
import { createWriteToolDefinition } from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/write.js';

const cwd = '/work/mox-notes';
const contextFiles = [{ path: '/work/mox-notes/AGENTS.md', content: '用 pnpm，不要用 npm。提交前运行 pnpm test。' }];
const defs = [createReadToolDefinition(cwd), createBashToolDefinition(cwd), createEditToolDefinition(cwd), createWriteToolDefinition(cwd)];
void [createBashTool, createEditTool, createReadTool, createWriteTool];

const pi = buildSystemPrompt({
  cwd,
  contextFiles,
  toolSnippets: Object.fromEntries(defs.map((d: any) => [d.name, d.promptSnippet])),
  toolGuidelines: Object.fromEntries(defs.map((d: any) => [d.name, d.promptGuidelines ?? []])),
});
console.log('━━━━ Pi v1.5.0 ━━━━');
console.log(pi.replace(/\/[^\s]*node_modules\/@earendil-works\/pi-coding-agent/g, '<pi 安装目录>'));
console.log('\n━━━━ mox ━━━━');
console.log(renderSections(buildPromptSections({ cwd, tools: createCodingTools(cwd), contextFiles })));
