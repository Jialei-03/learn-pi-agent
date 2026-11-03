// mox 版本的 web_fetch 扩展（第 9 章）：和 Pi 版本共用 fetch.ts，只是注册方式不同。
// 用法：node mox/src/cli.ts --ext extensions/web-fetch/mox.ts
import type { MoxExtensionAPI } from '../../mox/src/extensions.ts';
import { checkUrl, formatResult, webFetch, type WebFetchOptions } from './fetch.ts';

export function createWebFetchMoxExtension(options: WebFetchOptions = {}) {
  return (api: MoxExtensionAPI) => {
    api.registerTool({
      name: 'web_fetch',
      description: '抓取一个网页或文本 URL，返回提取后的正文。只能访问公网地址；内容超过 50KB 会被截断。',
      parameters: { type: 'object', properties: { url: { type: 'string', description: '完整的 http(s) URL' } }, required: ['url'] },
      async execute({ url }, { signal }) { return formatResult(await webFetch(url, options, signal)); },
    });
    api.on('tool_call', async ({ toolName, input }) => {
      if (toolName !== 'web_fetch') return;
      const refusal = await checkUrl(String(input.url ?? ''), options);
      if (refusal) return { block: true, reason: refusal };
    });
  };
}

export default createWebFetchMoxExtension({ allowedDomains: process.env.MOX_WEB_FETCH_DOMAINS?.split(',').filter(Boolean) });
