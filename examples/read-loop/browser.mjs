import { obj, str } from '@earendil-works/pi-schema';
import { runExample } from './run.mjs';

// The browser adapter intentionally reads only the editable in-memory README.
export function runBrowserExample(text, scenario) {
  const read = {
    name: 'read',
    label: '读取示例文件',
    description: '读取示例工作区里的纯文本文件',
    parameters: obj({ path: str() }),
    async execute(_id, { path }) {
      if (path !== 'README.md') throw new Error('示例工作区找不到 ' + path);
      return { content: [{ type: 'text', text }], details: undefined };
    },
  };
  return runExample(read, scenario);
}

export { runBatch } from './batch.mjs';
