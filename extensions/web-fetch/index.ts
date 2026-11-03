// Pi 扩展：web_fetch（第 9 章）。Pi 没有内置网页抓取，用一个扩展补上。
//
// 安装：把这个目录复制到 ~/.pi/agent/extensions/web-fetch/，或者
//   pi -e ./extensions/web-fetch/index.ts
//
// 它做了两件事：注册一个 web_fetch 工具；监听 tool_call 事件，按域名白名单拦截。
// 白名单来自环境变量 PI_WEB_FETCH_DOMAINS（逗号分隔）；不设置则允许所有公网地址。
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { checkUrl, formatResult, webFetch, type WebFetchOptions } from './fetch.ts';

export function createWebFetchExtension(options: WebFetchOptions = {}) {
  return function webFetchExtension(pi: ExtensionAPI) {
    pi.registerTool({
      name: 'web_fetch',
      label: 'web_fetch',
      description: '抓取一个网页或文本 URL，返回提取后的正文。用于查阅文档、错误信息、发布说明。只能访问公网地址；内容超过 50KB 会被截断。',
      promptSnippet: 'Fetch a web page and return its text',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: '完整的 http(s) URL' } },
        required: ['url'],
      } as any,
      async execute(_toolCallId, params: { url: string }, signal) {
        const result = await webFetch(params.url, options, signal);
        return { content: [{ type: 'text', text: formatResult(result) }], details: { url: result.url, status: result.status, truncated: result.truncated } };
      },
    });

    // 同一个检查也挂在 tool_call 上：执行前就拦下，界面上能看到“被拒绝”，而不是“执行失败”
    pi.on('tool_call', async event => {
      if (event.toolName !== 'web_fetch') return undefined;
      const refusal = await checkUrl(String((event.input as { url?: string }).url ?? ''), options);
      return refusal ? { block: true, reason: refusal } : undefined;
    });
  };
}

export default createWebFetchExtension({
  allowedDomains: process.env.PI_WEB_FETCH_DOMAINS?.split(',').map(d => d.trim()).filter(Boolean),
});
