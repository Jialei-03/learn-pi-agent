import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contentText } from '@earendil-works/pi-ai';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { openDemo } from './course-session.mjs';

const modes = ['ready', 'skip-reload', 'wrong-dir'];
for (const mode of modes) {
  const root = await mkdtemp(join(tmpdir(), 'pi-template-'));
  const cwd = join(root, 'project'), agentDir = join(root, 'config');
  try {
    await Promise.all([mkdir(cwd), mkdir(agentDir)]);
    const path = mode === 'wrong-dir' ? 'notes/overview.md' : '.pi/prompts/overview.md';
    const content = '请核对 [$1] 的入口。';
    let input;
    const session = await openDemo({ cwd, agentDir, tools: ['write'], sessionManager: SessionManager.inMemory(cwd), responses: [
      fauxAssistantMessage(fauxToolCall('write', { path, content }, { id: 'write-1' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('已创建。'),
      context => {
        input = contentText(context.messages.findLast(m => m.role === 'user').content);
        return fauxAssistantMessage('收到。');
      },
    ] });
    try {
      const loaded = () => session.resourceLoader.getPrompts().prompts.some(p => p.name === 'overview');
      await session.prompt('在项目中创建 overview 模板。');
      assert.equal(await readFile(join(cwd, path), 'utf8'), content);
      const inPlace = await readFile(join(cwd, '.pi/prompts/overview.md'), 'utf8').then(s => s === content, () => false);
      const before = loaded();
      if (mode !== 'skip-reload') await session.reload();
      await session.prompt('/overview cli');
      console.log(mode + '  正确位置=' + inPlace + '  刷新前=' + before + '  可发现=' + loaded() + '  模型输入=' + input);
      assert.equal(before, false);
      assert.equal(inPlace, mode !== 'wrong-dir');
      assert.equal(loaded(), mode === 'ready');
      assert.equal(input, mode === 'ready' ? '请核对 [cli] 的入口。' : '/overview cli');
    } finally { session.dispose(); }
  } finally { await rm(root, { recursive: true, force: true }); }
}
