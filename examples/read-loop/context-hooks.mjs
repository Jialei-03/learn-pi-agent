import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DefaultResourceLoader, ExtensionRunner, ModelRegistry, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';

const cwd = await mkdtemp(join(tmpdir(), 'pi-context-hooks-'));
try {
  let prune = false;
  let lastContext;
  const extension = pi => {
    pi.on('context', (event, ctx) => {
      lastContext = ctx;
      if (prune) return { messages: event.messages.slice(-1) };
      return { messages: [...event.messages] };
    });
  };
  const loader = new DefaultResourceLoader({ cwd, agentDir: cwd, noExtensions: true,
    extensionFactories: [extension], noContextFiles: true });
  await loader.reload();
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  const modelRuntime = await ModelRuntime.create({ authPath: join(cwd, 'auth.json'), modelsPath: null, refreshOnCreate: false });
  const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, cwd,
    SessionManager.inMemory(cwd), new ModelRegistry(modelRuntime));
  const messages = [
    { role: 'system', content: '', sections: { policy: 'old' }, timestamp: 1 },
    { role: 'user', content: 'first', timestamp: 2 },
    { role: 'system', content: '', sections: { policy: 'new' }, timestamp: 3 },
    { role: 'user', content: 'second', timestamp: 4 },
  ];
  const roles = items => items.map(item => item.role).join(' → ');
  const untouched = await runner.emitContext(messages);
  assert.equal(roles(untouched), roles(messages));
  prune = true;
  const selected = await runner.emitContext(messages);
  assert.deepEqual(selected.map(m => m.role), ['system', 'user']);
  assert.equal(selected[0].sections.policy, 'new');
  assert.equal(selected[1].content, 'second');
  console.log('复制列表保留原顺序  ' + roles(untouched));
  console.log('只保留最后用户消息  ' + roles(selected) + '，policy=' + selected[0].sections.policy);
  console.log('原始输入仍有 ' + messages.length + ' 条');
  runner.invalidate();
  assert.throws(() => lastContext.getContextUsage(), /stale/);
  console.log('runner 失效后，旧 ctx.getContextUsage() 抛出 stale 错误');
} finally {
  await rm(cwd, { recursive: true, force: true });
}
