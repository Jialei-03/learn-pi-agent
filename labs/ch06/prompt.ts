// 第 6 章实验：Pi 真正发给模型的系统提示长什么样？
//   node labs/ch06/prompt.ts
// Pi 的 buildSystemPrompt 不是公开 API，这里按文件路径导入它的构建产物，只用于阅读。
// 工具的一句话说明和使用规则，取自 Pi 四个默认工具各自的 promptSnippet / promptGuidelines。
import assert from 'node:assert/strict';
import { buildSystemPrompt } from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js';
import { createBashToolDefinition } from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/bash.js';
import { createEditToolDefinition } from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/edit.js';
import { createReadToolDefinition } from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/read.js';
import { createWriteToolDefinition } from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/write.js';

// ── Pi ──
const piCwd = '/work/mox-notes';
const contextFiles = [{ path: '/work/mox-notes/AGENTS.md', content: '用 pnpm，不要用 npm。提交前运行 pnpm test。' }];
const defs = [createReadToolDefinition(piCwd), createBashToolDefinition(piCwd), createEditToolDefinition(piCwd), createWriteToolDefinition(piCwd)];
const piPrompt = buildSystemPrompt({
  cwd: piCwd,
  contextFiles,
  toolSnippets: Object.fromEntries(defs.map((d: any) => [d.name, d.promptSnippet])),
  toolGuidelines: Object.fromEntries(defs.map((d: any) => [d.name, d.promptGuidelines ?? []])),
}).replace(/\/[^\s]*node_modules\/@earendil-works\/pi-coding-agent/g, '<pi 安装目录>');

console.log(piPrompt);
console.log(`\n长度：${piPrompt.split('\n').length} 行 / ${piPrompt.length} 字符`);

assert.match(piPrompt, /<project_instructions path="\/work\/mox-notes\/AGENTS\.md">/);
assert.ok(!/\d{4}-\d\d-\d\d/.test(piPrompt.replace(/<cwd>[\s\S]*<\/cwd>/, '')));   // 没有日期和时间戳
