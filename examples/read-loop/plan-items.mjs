import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Load the TypeScript utility from Pi's shipped example using its own TS loader dependency.
const entry = import.meta.resolve('@earendil-works/pi-coding-agent');
const ts = createRequire(entry)('jiti').createJiti(import.meta.url);
const path = fileURLToPath(new URL('../examples/extensions/plan-mode/utils.ts', entry));
const { extractTodoItems, markCompletedSteps, isSafeCommand } = await ts.import(path);
const description = 'Plan:\n8. Read the parser source\n9. OK\n17) Verify the regression test';
const items = extractTodoItems(description);
assert.deepEqual(items.map(t => [t.step,t.text]), [[1,'Parser source'],[2,'Regression test']]);
console.log('提取结果：' + items.map(t => t.step + ':' + t.text).join(' | '));
const count = markCompletedSteps('[DONE:2] [DONE:2] [DONE:99]',items);
console.log('识别标记：' + count + '；完成的项：' + items.filter(t => t.completed).map(t => t.step));
assert.equal(count, 3);
assert.deepEqual(items.map(t => t.completed),[false,true]);
assert.equal(extractTodoItems(description.replace('Plan:', '计划：')).length,0);
console.log('只换为中文标题，提取条数：0');
for (const cmd of ['git status','echo hello > out.txt']) console.log(cmd + '：' + isSafeCommand(cmd));
