// 第 11 章实验：提示模板——一个 Markdown 文件就是一个 /命令。Pi 内置，mox 没有，这里用参考实现补上并对照。
//   node labs/ch11/templates.ts
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/compat';
import { createPiSession, textOf } from '../shared/pi-session.ts';
import { expandTemplate, loadTemplates } from './template.ts';

const root = mkdtempSync(join(tmpdir(), 'ch11-tpl-'));
const dir = join(root, 'prompts');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'review.md'), `---
description: 审查暂存区的改动
---
审查 git 暂存区的改动，重点关注 \${1:-正确性、安全和错误处理}。
涉及的文件：\${@:2}
`);

try {
  const templates = loadTemplates(dir);
  const rows = ['| 输入 | 参考实现展开的结果 | 和 Pi 一致 |', '| --- | --- | --- |'];
  for (const input of ['/review', '/review 并发', '/review "并发与锁" src/queue.ts src/worker.ts', '/review $1 x']) {
    const { session } = await createPiSession({ promptTemplatePaths: [dir], responses: [fauxAssistantMessage('好的。')] });
    await session.prompt(input);
    const pi = textOf(session.messages.find((m: any) => m.role === 'user'));
    session.dispose();
    const ref = expandTemplate(input, templates);
    rows.push(`| \`${input}\` | ${ref.replace(/\n/g, ' ⏎ ')} | ${ref.trim() === pi.trim() ? '是' : '否'} |`);
    assert.equal(ref.trim(), pi.trim(), input);
  }
  console.log(rows.join('\n'));
  console.log('\n最后一行的参数是字面的 "$1"：替换只扫一遍，它不会被当成第一个参数再展开一次。');
} finally {
  rmSync(root, { recursive: true, force: true });
}
