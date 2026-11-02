import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contentText } from '@earendil-works/pi-ai';
import { fauxAssistantMessage as reply, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { openDemo } from './course-session.mjs';

const root = await mkdtemp(join(tmpdir(), 'pi-resume-'));
const cwd = join(root, 'project'), agentDir = join(root,'config'), sessions = join(root,'sessions');
const read = id => reply(fauxToolCall('read', {path:'README.md'}, { id }), {stopReason: 'toolUse'});
const results = messages => messages.filter(m => m.role === 'toolResult').map(m => contentText(m.content).trim());
try {
  await Promise.all([mkdir(cwd), mkdir(agentDir), mkdir(sessions)]);
  await writeFile(join(cwd,'README.md'), '用途：整理旧笔记。');
  const first = SessionManager.create(cwd, sessions);
  const a = await openDemo({ cwd, agentDir, tools: ['read'], sessionManager: first, responses: [
    read('once'), ctx => reply(results(ctx.messages).at(-1)),
  ] });
  const log = first.getSessionFile();
  try {
    console.log('仅装配，文件已存在：' + existsSync(log));
    // Observe the public event before this message is appended to the session tree.
    const off = a.subscribe(e => {
      if (e.type === 'message_end' && e.message.role === 'user') {
        const live = a.agent.state.messages.some(m => m === e.message);
        const logged = first.getBranch().some(row => row.type === 'message' && row.message.role === 'user');
        console.log('第一次 user 结束事件内：Agent 已有=' + live + '；会话树已有=' + logged);
        assert.ok(live && !logged);
      }
    });
    try { await a.prompt('读取 README'); } finally { off(); }
    console.log('首次读取：' + results(a.state.messages)[0]);
  } finally { a.dispose(); }
  const entries = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  console.log('文件中的消息：' + entries.filter(e => e.type === 'message').map(e => e.message.role).join(' → '));
  await writeFile(join(cwd,'README.md'), '用途：生成新索引。');
  const reopened = SessionManager.open(log);
  const b = await openDemo({ cwd, agentDir, tools: ['read'], sessionManager: reopened, responses: [
    read('twice'), ctx => reply(results(ctx.messages).join(' / ')),
  ] });
  try {
    assert.deepEqual(results(b.state.messages), ['用途：整理旧笔记。']);
    console.log('刚恢复，历史结果：' + results(b.state.messages)[0]);
    await b.prompt('现在重新读取 README');
    assert.deepEqual(results(b.state.messages), ['用途：整理旧笔记。','用途：生成新索引。']);
    console.log('再次调用后，两个结果：' + results(b.state.messages).join(' / '));
  } finally { b.dispose(); }
} finally { await rm(root, {recursive:true, force:true}); }
