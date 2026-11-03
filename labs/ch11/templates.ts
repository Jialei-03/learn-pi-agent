// 第 11 章实验：提示模板——一个 Markdown 文件就是一个 /命令。
//   node labs/ch11/templates.ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/compat';
import { expandTemplate, loadTemplates } from '../../mox/src/skills.ts';
import { createPiSession, textOf } from '../shared/pi-session.ts';

const dir = join(mkdtempSync(join(tmpdir(), 'ch11-tpl-')), 'prompts');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'review.md'), `---
description: 审查暂存区的改动
---
审查 git 暂存区的改动，重点关注 \${1:-正确性、安全和错误处理}。
涉及的文件：\${@:2}
`);

const inputs = ['/review', '/review 并发', '/review "并发与锁" src/queue.ts src/worker.ts'];
const templates = loadTemplates(dir);
for (const input of inputs) {
  const { session } = await createPiSession({ promptTemplatePaths: [dir], responses: [fauxAssistantMessage('好的。')] });
  await session.prompt(input);
  const pi = textOf(session.messages.find((m: any) => m.role === 'user'));
  session.dispose();
  const mox = expandTemplate(input, templates);
  console.log(`输入：${input}`);
  console.log(`  mox：${mox.replace(/\n/g, ' ⏎ ')}`);
  console.log(`  Pi ：${pi.replace(/\n/g, ' ⏎ ')}`);
  console.log(`  一致：${mox.trim() === pi.trim() ? '是' : '否'}\n`);
}
