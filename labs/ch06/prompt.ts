// 第 6 章实验：mox 真正发给模型的系统提示长什么样？Pi 的呢？
//   node labs/ch06/prompt.ts
// mox 一侧的组装方式和 mox/src/cli.ts 一样：systemPrompt()（基本规则 + 项目说明 + Skills 目录）
// 再接上扩展用 addSystemPrompt 注册的片段。
// Pi 的 buildSystemPrompt 不是公开 API，这里按文件路径导入它的构建产物，只用于阅读。
// 工具的一句话说明和使用规则，取自 Pi 四个默认工具各自的 promptSnippet / promptGuidelines。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSystemPrompt } from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js';
import { createBashToolDefinition } from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/bash.js';
import { createEditToolDefinition } from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/edit.js';
import { createReadToolDefinition } from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/read.js';
import { createWriteToolDefinition } from '../../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/write.js';
import { loadSkills, systemPrompt } from '../../mox/src/context.ts';
import { loadExtensions, type Extension } from '../../mox/src/extensions.ts';

// ── mox ──
const root = mkdtempSync(join(tmpdir(), 'ch06-prompt-'));
const write = (path: string, text: string) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), text); };
const cwd = join(root, 'work/mox-notes');
write('work/mox-notes/AGENTS.md', '用 pnpm，不要用 npm。提交前运行 pnpm test。');
write('home/.mox/skills/release/SKILL.md', '---\nname: release\ndescription: 发布新版本时使用：改版本号、写更新日志、打 tag\n---\n\n（完整步骤省略）');

const skills = loadSkills([join(root, 'home/.mox/skills')]);
const basePrompt = systemPrompt(cwd, join(root, 'home'), skills);
const planMode: Extension = mox => mox.addSystemPrompt(() => '计划模式已开启：只读，不要修改文件，先给出计划。');
const extensions = await loadExtensions([planMode], { cwd, tools: [], ask: async () => undefined });
const moxPrompt = [basePrompt, ...extensions.prompts.map(part => part())].filter(Boolean).join('\n\n');   // 和 cli.ts 里的 system() 一样

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

const shown = moxPrompt.replaceAll(root, '').replace(/今天：\d{4}-\d\d-\d\d/, '今天：<日期>');
console.log('━━━━ mox ━━━━');
console.log(shown);
console.log('\n━━━━ Pi v1.5.0 ━━━━');
console.log(piPrompt);
console.log(`\n长度：mox ${moxPrompt.split('\n').length} 行 / ${moxPrompt.length} 字符；Pi ${piPrompt.split('\n').length} 行 / ${piPrompt.length} 字符`);

assert.match(moxPrompt, /<file path=".*AGENTS\.md">/);
assert.match(moxPrompt, /- release：发布新版本时使用/);
assert.ok(moxPrompt.endsWith('计划模式已开启：只读，不要修改文件，先给出计划。'));   // 扩展的片段在最后
assert.ok(moxPrompt.split('\n').length < piPrompt.split('\n').length);
