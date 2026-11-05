// 第 11 章实验：Pi 的提示模板——一个 Markdown 文件就是一个 /命令。
//   node labs/ch11/pi-templates.ts
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/compat';
import { createPiSession, textOf } from '../shared/pi-session.ts';

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
  const expected: Record<string, string> = {
    '/review': '审查 git 暂存区的改动，重点关注 正确性、安全和错误处理。\n涉及的文件：',
    '/review 并发': '审查 git 暂存区的改动，重点关注 并发。\n涉及的文件：',
    '/review "并发与锁" src/queue.ts src/worker.ts': '审查 git 暂存区的改动，重点关注 并发与锁。\n涉及的文件：src/queue.ts src/worker.ts',
    '/review $1 x': '审查 git 暂存区的改动，重点关注 $1。\n涉及的文件：x',
  };
  console.log('| 输入 | 模型收到的用户消息 |\n| --- | --- |');
  for (const [input, want] of Object.entries(expected)) {
    const { session } = await createPiSession({ promptTemplatePaths: [dir], responses: [fauxAssistantMessage('好的。')] });
    await session.prompt(input);
    const got = textOf(session.messages.find((m: any) => m.role === 'user')).trim();
    session.dispose();
    console.log(`| \`${input}\` | ${got.replace(/\n/g, ' ⏎ ')} |`);
    assert.equal(got, want.trim(), input);
  }
  console.log('\n参数按 shell 的规则切分，所以 "并发与锁" 是一个参数；最后一行的参数是字面的 $1，替换只做一遍，它不会被再展开。');
} finally {
  rmSync(root, { recursive: true, force: true });
}
