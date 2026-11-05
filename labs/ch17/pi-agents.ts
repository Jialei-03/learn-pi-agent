// 第 17 章实验：Pi 的子 Agent 示例自带哪几个子 Agent，各自拿到什么？
//   node labs/ch17/pi-agents.ts
// 读的是 Pi 包里随附的真实定义文件（examples/extensions/subagent/agents/*.md），用 Pi 自己的 parseFrontmatter 解析。
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '@earendil-works/pi-coding-agent';

const dir = fileURLToPath(new URL('../../node_modules/@earendil-works/pi-coding-agent/examples/extensions/subagent/agents/', import.meta.url));
const agents = readdirSync(dir).filter(f => f.endsWith('.md')).sort().map(file => {
  const { frontmatter, body } = parseFrontmatter<{ name: string; description: string; tools?: string; model?: string }>(readFileSync(dir + file, 'utf8'));
  return { ...frontmatter, prompt: body.trim() };
});

console.log('| 子 Agent | 工具（--tools） | 模型（--model） | 系统提示 | 描述 |\n| --- | --- | --- | --- | --- |');
for (const a of agents) console.log(`| ${a.name} | ${a.tools ?? '全部'} | ${a.model ?? '继承父 Agent'} | ${a.prompt.length} 字符 | ${a.description} |`);
const readOnly = new Set(['read', 'grep', 'find', 'ls']);
const names = agents.filter(a => a.tools && a.tools.split(',').every(t => readOnly.has(t.trim()))).map(a => a.name);
console.log(`\n只给了只读工具的：${names.join('、')}。其余的带着 bash，所谓“只读”靠的是系统提示。`);

assert.deepEqual(agents.map(a => a.name), ['planner', 'reviewer', 'scout', 'worker']);
assert.ok(agents.every(a => a.description && a.prompt));
assert.deepEqual(names, ['planner']);
assert.equal(agents.find(a => a.name === 'worker')!.tools, undefined);
