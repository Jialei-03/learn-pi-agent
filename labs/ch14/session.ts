// 第 14 章实验：权限扩展装进一个真实的 Pi 会话。界面是脚本：每次弹出确认框，按预先写好的答案选择。
// （mox 一侧的同一组情况见 labs/ch14/mox-session.ts）
//   node labs/ch14/session.ts
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/compat';
import { createPermissionsExtension } from '../../extensions/permissions/index.ts';
import { createPiSession, textOf } from '../shared/pi-session.ts';

function project() {
  const cwd = mkdtempSync(join(tmpdir(), 'ch14-'));
  mkdirSync(join(cwd, 'src'));
  writeFileSync(join(cwd, 'src', 'app.ts'), 'export const port = 3000;\n');
  writeFileSync(join(cwd, '.env'), 'TOKEN=secret\n');
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'demo', scripts: { build: 'echo built' } }));
  writeFileSync(join(cwd, '.gitignore'), '.env\npermissions.json\n');
  writeFileSync(join(cwd, 'permissions.json'), JSON.stringify({ permissions: { deny: ['Read(.env)', 'Bash(rm *)'], allow: ['Bash(npm run *)'] } }));
  execSync('git init -q && git config user.email lab@example.com && git config user.name lab', { cwd });
  return cwd;
}
const call = (name: string, args: object, id: string) => fauxAssistantMessage(fauxToolCall(name, args, { id }), { stopReason: 'toolUse' });
const steps = [
  call('read', { path: 'src/app.ts' }, 'r1'),
  call('bash', { command: 'npm run build' }, 'b1'),
  call('bash', { command: 'git add -A && git commit -m "wip"' }, 'b2'),
  call('edit', { path: 'src/app.ts', edits: [{ oldText: '3000', newText: '8080' }] }, 'e1'),
  call('write', { path: 'src/util.ts', content: 'export {};\n' }, 'w1'),
  call('bash', { command: 'cat .env' }, 'b3'),
  call('bash', { command: `python3 -c "print(open('.env').read())"` }, 'b4'),
  fauxAssistantMessage('完成。'),
];

const outcomes: Record<string, boolean[]> = {};
// 正文的结论：每一步的放行 / 拒绝（顺序同 steps：read、npm run build、git commit、edit、write、cat .env、python），以及弹出了几次确认框
const expected: Record<string, { allowed: boolean[]; dialogs: string[] }> = {
  '有界面：用户逐个确认': { allowed: [true, true, true, true, true, false, false], dialogs: ['git add -A && git commit', 'edit', 'python3'] },
  '没有界面（比如 pi -p 在 CI 里运行）': { allowed: [true, true, false, false, false, false, false], dialogs: [] },
  '计划模式': { allowed: [true, false, false, false, false, false, false], dialogs: [] },
};

async function run(title: string, answers: string[] | undefined, mode?: 'plan') {
  const cwd = project();
  const dialogs: string[] = [];
  const ui = answers && {
    select: async (title: string) => { const a = answers.shift() ?? '拒绝'; dialogs.push(`${title.split('\n')[1]} → 「${a}」`); return a; },
    notify: () => {},
  };
  const { session } = await createPiSession({
    cwd, responses: steps, ui,
    extensions: [createPermissionsExtension({ files: () => [{ path: join(cwd, 'permissions.json'), base: cwd }], mode })],
  });
  await session.prompt('把端口改成 8080，加一个 util.ts，提交一下，顺便看看 .env 里配了什么');
  console.log(`━━ ${title} ━━`);
  for (const m of session.messages as any[]) {
    if (m.role !== 'toolResult') continue;
    const args = (session.messages as any[]).flatMap(x => x.role === 'assistant' ? x.content : []).find((b: any) => b.id === m.toolCallId)?.arguments;
    const what = m.toolName === 'bash' ? args.command : `${m.toolName} ${args.path}`;
    (outcomes[title] ??= []).push(!m.isError);
    console.log(`${m.isError ? '✗' : '✓'} ${what}${m.isError ? `\n    ${textOf(m).split('\n')[0]}` : ''}`);
  }
  if (dialogs.length) console.log(`弹出的确认框：\n${dialogs.map(x => `    ${x}`).join('\n')}`);
  assert.deepEqual(outcomes[title], expected[title].allowed, `${title}：每一步的放行 / 拒绝`);
  assert.equal(dialogs.length, expected[title].dialogs.length, `${title}：确认框的数量`);
  expected[title].dialogs.forEach((prefix, i) => assert.ok(dialogs[i].startsWith(prefix), `${title}：第 ${i + 1} 个确认框应该是 ${prefix}，实际是 ${dialogs[i]}`));
  session.dispose();
  console.log();
}

await run('有界面：用户逐个确认', ['允许一次', '本会话都允许', '拒绝']);
await run('没有界面（比如 pi -p 在 CI 里运行）', undefined);
await run('计划模式', [], 'plan');
