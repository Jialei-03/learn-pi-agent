import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEditTool } from '@earendil-works/pi-coding-agent';

const cwd = await mkdtemp(join(tmpdir(), 'pi-edit-course-'));
const path = 'config.txt';
const file = join(cwd, path);
const edit = (oldText, newText) => ({ oldText, newText });
const original = 'prod:\n  limit=10\ndev:\n  limit=10\n';

async function observe({ label, before = original, edits, after, error, abortAfterWrite = false }) {
  // The setup write is outside the instrumented tool backend.
  await writeFile(file, before);
  const controller = new AbortController();
  let writes = 0;
  const tool = createEditTool(cwd, {
    operations: {
      access, readFile,
      async writeFile(filePath, text) {
        writes += 1;
        await writeFile(filePath, text);
        if (abortAfterWrite) controller.abort();
      },
    },
  });
  const run = tool.execute(label, {path, edits}, controller.signal);
  if (error) await assert.rejects(run, error);
  else assert.ok((await run).details.patch.includes('@@'));
  const bytes = await readFile(file);
  assert.deepEqual(bytes, Buffer.from(after));
  assert.equal(writes, before === after ? 0 : 1);
  console.log(label + ' | 宿主写入 ' + writes + ' 次 | ' + JSON.stringify(bytes.toString()));
}
try {
  await observe({ label: '重复目标', edits: [edit('  limit=10\n', '  limit=12\n')], error: /2 occurrences/, after: original });
  const devOnly = original.replace('dev:\n  limit=10', 'dev:\n  limit=12');
  await observe({ label: '给出相邻行', edits: [edit('dev:\n  limit=10', 'dev:\n  limit=12')], after: devOnly });
  await observe({ label: '批次的第二项找不到', edits: [edit('prod:', 'production:'),edit('limit=99','limit=12')], error: /edits\[1\]/, after: original });
  await observe({ label: '区间重叠', edits: [edit('prod:\n  limit=10', 'production:'),edit('prod:', 'production:')], error: /overlap/i, after: original });
  const smart = 'name=“dev”\nname="dev"\n';
  await observe({ label: '精确命中但归一化后重复', before: smart, edits: [edit('name="dev"', 'name="test"')], error: /2 occurrences/, after: smart });
  await observe({ label: '不同长度的批量替换', before: '\uFEFFaa\r\nzz\r\n',
    edits: [edit('aa', 'aaaaaaa'),edit('zz','Z')], after: '\uFEFFaaaaaaa\r\nZ\r\n' });
  await observe({ label: '写入完成后取消', edits: [edit('dev:\n  limit=10', 'dev:\n  limit=12')], abortAfterWrite: true, error: /aborted/i, after: devOnly });
} finally { await rm(cwd, {recursive: true, force: true}); }
