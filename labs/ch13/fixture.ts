// 第 13 章实验共用：一个临时项目，以及一份 Claude Code 格式的钩子配置（指向 labs/fixtures/hooks/ 下的脚本）。
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS = fileURLToPath(new URL('../fixtures/hooks/', import.meta.url));
const node = (script: string) => ({ type: 'command', command: `node ${HOOKS}${script}` });
const sh = (script: string) => ({ type: 'command', command: `sh ${HOOKS}${script}` });

export const hooksConfig = {
  hooks: {
    SessionStart: [{ hooks: [sh('session-info.sh')] }],
    UserPromptSubmit: [{ hooks: [node('prompt-guard.mjs')] }],
    PreToolUse: [
      { matcher: 'Bash', hooks: [sh('block-dangerous.sh'), node('dry-run-deploy.mjs')] },
      { matcher: 'Read|Edit|Write', hooks: [node('protect-env.mjs')] },
    ],
    PostToolUse: [{ matcher: 'Bash', hooks: [node('redact-secrets.mjs')] }],
    Stop: [{ hooks: [node('require-tests.mjs')] }],
  },
};

export function createProject() {
  const cwd = mkdtempSync(join(tmpdir(), 'ch13-'));
  writeFileSync(join(cwd, 'deploy.sh'), '#!/bin/sh\necho "deploy $@"\n', { mode: 0o755 });
  writeFileSync(join(cwd, 'config.txt'), 'region=cn-north\napi_key=sk-live-9f8e7d6c5b4a\n');
  writeFileSync(join(cwd, '.env'), 'DB_PASSWORD=hunter2\n');
  mkdirSync(join(cwd, 'build'));
  const hooksFile = join(cwd, 'hooks.json');
  writeFileSync(hooksFile, JSON.stringify(hooksConfig, null, 2));
  return { cwd, hooksFile };
}

/** 两边共用的模型脚本：每一步是一次工具调用，或一段文字回复。 */
export const steps: ({ tool: string; args: Record<string, unknown> } | { text: string })[] = [
  { tool: 'bash', args: { command: 'rm -rf build' } },
  { tool: 'bash', args: { command: './deploy.sh production' } },
  { tool: 'read', args: { path: '.env' } },
  { tool: 'bash', args: { command: 'cat config.txt' } },
  { text: '都处理好了。' },
  { tool: 'bash', args: { command: 'echo "12 passed"' } },
  { text: '测试通过（12 passed），全部完成。' },
];
