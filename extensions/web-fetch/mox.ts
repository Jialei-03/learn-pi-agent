// mox 版本的 web_fetch 扩展（第 9 章）：和 Pi 版本共用 fetch.ts，只是注册方式不同。
// 用法：mox -e extensions/web-fetch/mox.ts
import type { ExtensionApi } from '../../mox/src/extensions.ts';
import { checkUrl, formatResult, webFetch, type WebFetchOptions } from './fetch.ts';

export function createWebFetchMoxExtension(options: WebFetchOptions = {}) {
  return (mox: ExtensionApi) => {
    // #region register
    mox.registerTool({
      name: 'web_fetch',
      description: '抓取一个网页或文本 URL，返回提取后的正文。只能访问公网地址；内容超过 50KB 会被截断。',
      parameters: { type: 'object', properties: { url: { type: 'string', description: '完整的 http(s) URL' } }, required: ['url'] },
      async run({ url }, signal) { return formatResult(await webFetch(url, options, signal)); },
    });
    // #endregion
    // #region guard
    // 同一个检查也挂在 tool_call 上：执行前就拦下，返回的字符串就是给模型看的理由
    mox.on('tool_call', async (name, args) => {
      if (name !== 'web_fetch') return;
      return await checkUrl(String(args.url ?? ''), options);
    });
    // #endregion
  };
}

export default createWebFetchMoxExtension({ allowedDomains: process.env.MOX_WEB_FETCH_DOMAINS?.split(',').filter(Boolean) });
