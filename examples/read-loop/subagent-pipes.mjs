import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// The upstream tool relaunches the current entry script in JSON mode. In that role
// we act as a scripted child, leaving spawning, framing, wrapping, and abort to Pi.
if (process.argv.includes('--mode')) {
  const task = process.argv.at(-1);
  if (task === 'Task: fail') {
    process.stderr.write('index unavailable\n');
    process.exitCode = 2;
  } else {
    const message = {
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'stop', content: [
        { type: 'text', text: 'src/args.ts:parseName' }, { type: 'text', text: 'Second text block' },
      ] },
    };
    const line = JSON.stringify(message);
    process.stdout.write(line.slice(0, 19));
    await delay(15);
    // Normal close flushes a final record without its delimiter. The cancellation
    // branch emits a full line first so that the parent can observe its update.
    process.stdout.write(line.slice(19) + (task === 'Task: wait' ? '\n' : ''));
    if (task === 'Task: wait') await delay(10_000);
  }
} else {
  const { DefaultResourceLoader } = await import('@earendil-works/pi-coding-agent');
  const upstream = fileURLToPath(new URL('../examples/extensions/subagent/index.ts',
    import.meta.resolve('@earendil-works/pi-coding-agent')));
  const cwd = await mkdtemp(join(tmpdir(), 'pi-child-pipes-'));
  try {
    const rolesDir = join(cwd, '.pi', 'agents');
    await mkdir(rolesDir, { recursive: true });
    await writeFile(join(rolesDir, 'scout.md'), '---\nname: scout\ndescription: Demo role\n---\nFind the parser.\n');
    const loader = new DefaultResourceLoader({ cwd, agentDir: join(cwd, 'settings'),
      noExtensions: true, additionalExtensionPaths: [upstream], noContextFiles: true });
    await loader.reload();
    const loaded = loader.getExtensions();
    assert.deepEqual(loaded.errors, []);
    const registered = loaded.extensions.flatMap(ext => [...ext.tools.values()])
      .find(tool => tool.definition.name === 'subagent');
    assert.ok(registered, 'Pi must load the upstream subagent extension');
    const run = (params, signal, update) => registered.definition.execute('parent-call',
      { agentScope: 'project', ...params }, signal, update, { cwd, hasUI: false });
    const ok = await run({ agent: 'scout', task: 'ok' });
    assert.equal(ok.content[0].text, 'src/args.ts:parseName');
    assert.equal(ok.details.results[0].messages[0].content.length, 2);
    console.log('成功  父模型收到', ok.content[0].text, '；详情保留 2 个文本块');

    const parallel = await run({ tasks: [ { agent: 'scout', task: 'fail' }, { agent: 'scout', task: 'ok' } ] });
    assert.deepEqual(parallel.details.results.map(result => result.exitCode), [2, 0]);
    assert.match(parallel.content[0].text, /1\/2 succeeded/);
    console.log('并行  输入顺序的退出码 [2, 0]；', parallel.content[0].text.split('\n')[0]);

    const controller = new AbortController();
    await assert.rejects(run({ agent: 'scout', task: 'wait' }, controller.signal,
      () => controller.abort('received first update')), /Subagent was aborted/);
    console.log('取消  父进程在收到第一条更新时发出取消，工具以 Subagent was aborted 结束');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
