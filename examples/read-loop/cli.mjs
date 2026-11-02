import { fileURLToPath } from 'node:url';
import { createReadTool } from '@earendil-works/pi-coding-agent';
import { runExample } from './run.mjs';

const directory = fileURLToPath(new URL('./fixtures/', import.meta.url));
const scenario = process.argv[2] ?? 'success';
const trace = await runExample(createReadTool(directory), scenario);
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(trace, null, 2));
} else {
  for (const [index, messages] of trace.requests.entries()) {
    console.log('请求 ' + (index + 1) + '  ' + messages.map(m => m.role).join(' → '));
  }
  console.log('read.execute 进入次数  ' + trace.executions.length);
  const result = trace.messages.find(m => m.role === 'toolResult');
  console.log('工具结果  ' + result.toolCallId + '  isError=' + result.isError);
  console.log(trace.messages.at(-1).content[0].text);
}
