// 第 7 章实验：Pi 的会话在进程退出之后还在。
//   node labs/ch07/resume.ts
// 第一个会话说一句话然后销毁；用同一个文件重新打开，再提一个问题。脚本模型自己不记任何东西，
// 能在第二次请求里看到第一轮的内容，只能是因为历史是从文件里读回来的。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/compat';
import { createPiSession, textOf } from '../shared/pi-session.ts';

const cwd = mkdtempSync(join(tmpdir(), 'ch07-resume-'));
try {
  const manager = SessionManager.create(cwd, join(cwd, 'sessions'));
  const first = await createPiSession({ cwd, sessionManager: manager, responses: [fauxAssistantMessage('好的，记住了。')] });
  await first.session.prompt('记住，代号是青鸟。');
  first.session.dispose();
  const file = manager.getSessionFile()!;
  const types = () => readFileSync(file, 'utf8').trim().split('\n').map(l => { const e = JSON.parse(l); return e.type === 'message' ? e.message.role : e.type; });
  console.log(`第一个会话销毁后，文件里的记录：${types().join('、')}`);
  assert.equal(types().filter(t => t === 'user' || t === 'assistant').length, 2);

  let seen: string[] = [];
  const second = await createPiSession({
    cwd, sessionManager: SessionManager.open(file, join(cwd, 'sessions')),
    responses: [(context: any) => { seen = context.messages.filter((m: any) => m.role === 'user').map((m: any) => textOf(m)); return fauxAssistantMessage('代号是青鸟。'); }],
  });
  await second.session.prompt('代号是什么？');
  second.session.dispose();
  console.log('重新打开后，第二次请求里的用户消息：');
  seen.forEach(t => console.log(`  │ ${t}`));
  console.log(`第二次之后：${types().join('、')}`);
  console.log('新的两条消息接在后面，前面的记录一行没动。');
  assert.deepEqual(seen, ['记住，代号是青鸟。', '代号是什么？']);
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
