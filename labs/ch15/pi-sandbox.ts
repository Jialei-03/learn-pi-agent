// 第 15 章实验：沙箱扩展装进 Pi。模型写的命令原样记在对话里，只是在启动进程时被包进了沙箱。
//   node labs/ch15/pi-sandbox.ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/compat';
import { createSandboxExtension } from '../../extensions/sandbox/index.ts';
import { detectSandbox } from '../../extensions/sandbox/policy.ts';
import { createPiSession, textOf } from '../shared/pi-session.ts';

if (!detectSandbox()) { console.log('这台机器上没有 sandbox-exec 或 bwrap，跳过实验。'); process.exit(0); }
const cwd = mkdtempSync(join(tmpdir(), 'ch15-pi-'));
writeFileSync(join(cwd, '.env'), 'DB_PASSWORD=hunter2\n');
const commands = [
  'echo "console.log(1)" > index.js && node index.js',
  `python3 -c "print(open('.env').read())"`,
  'cat ~/.ssh/id_rsa',
  'touch ~/Desktop/pwned.txt',
  'curl -sS -m 5 https://example.com -o /dev/null || echo "curl 失败，退出码 $?"',
];
const status: string[] = [];
const { session } = await createPiSession({
  cwd,
  ui: { setStatus: (_k: string, text: string) => { if (text) status.push(text); }, notify: () => {} },
  extensions: [createSandboxExtension({ denyRead: ['.env'] })],
  responses: [...commands.map((command, i) => fauxAssistantMessage(fauxToolCall('bash', { command }, { id: `b${i}` }), { stopReason: 'toolUse' })), fauxAssistantMessage('完成。')],
});
await session.prompt('跑几个命令');
console.log(`状态栏：${status.at(-1)}\n`);
for (const m of session.messages as any[]) {
  if (m.role === 'assistant') for (const b of m.content) if (b.type === 'toolCall') console.log(`$ ${b.arguments.command}`);
  if (m.role === 'toolResult') {
    const lines = textOf(m).trim().split('\n');
    // 输出里出现的家目录换成 ~：实验结果会放到网站上
    console.log(`  ${(lines.find((l: string) => /not permitted|EPERM|curl/i.test(l)) ?? lines[0]).replaceAll(homedir(), '~').slice(0, 100)}`);
  }
}
session.dispose();
