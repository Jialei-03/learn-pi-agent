import assert from 'node:assert/strict';
import { appendFileSync, existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

if (process.argv.includes('--mode')) {
  // Each child inherits the throwaway cwd from the real subagent scheduler.
  const name = process.argv.at(-1).replace(/^Task: /, '');
  appendFileSync('events.log', '+' + name + '\n');
  await writeFile('ready-' + name, '');
  const needed = name === 'B' ? ['A','C','D'] : name === 'E' ? [] : ['E'];
  const deadline = Date.now() + 10000;
  while (!needed.every(key => existsSync('ready-' + key))) {
    if (Date.now() > deadline) throw Error('Timed out waiting for ' + needed);
    await delay(10);
  }
  appendFileSync('events.log', '-' + name + '\n');
  console.log(JSON.stringify({ type:'message_end', message:{ role:'assistant', stopReason:'stop', content:[{type:'text',text:name}] } }));
} else {
  const { DefaultResourceLoader } = await import('@earendil-works/pi-coding-agent');
  const upstream = fileURLToPath(new URL('../examples/extensions/subagent/index.ts', import.meta.resolve('@earendil-works/pi-coding-agent')));
  const cwd = await mkdtemp(join(tmpdir(),'pi-workers-'));
  try {
    await mkdir(join(cwd,'.pi/agents'), {recursive:true});
    await writeFile(join(cwd,'.pi/agents/reader.md'),'---\nname: reader\ndescription: Demo reader\n---\nInspect an assigned input.');
    const loader = new DefaultResourceLoader({cwd, agentDir:join(cwd,'settings'), noExtensions:true, additionalExtensionPaths:[upstream], noContextFiles:true});
    await loader.reload();
    const loaded = loader.getExtensions();
    assert.deepEqual(loaded.errors, []);
    const tool = loaded.extensions.flatMap(e => [...e.tools.values()]).find(t => t.definition.name === 'subagent').definition;
    const tasks = ['A','B','C','D','E'].map(task => ({agent:'reader',task}));
    const result = await tool.execute('schedule', {agentScope:'project',tasks}, undefined, undefined, {cwd,hasUI:false});
    const events = (await readFile(join(cwd,'events.log'),'utf8')).trim().split('\n');
    let live = 0, peak = 0;
    for (const entry of events) { live += entry[0] === '+' ? 1 : -1; peak = Math.max(peak,live); }
    const names = result.details.results.map(r => r.messages.at(-1).content[0].text);
    assert.equal(peak,4);
    assert.ok(events.indexOf('-B') < events.indexOf('+E') && events.indexOf('+E') < events.indexOf('-A'));
    assert.deepEqual(names,['A','B','C','D','E']);
    console.log('子进程实际记录：' + events.join(' '));
    console.log('同时处理任务的峰值：' + peak + '；结果数组：' + names.join(' '));
  } finally { await rm(cwd,{recursive:true,force:true}); }
}
