// web_fetch 的核心逻辑（第 9 章）。Pi 扩展和 mox 的工具共用这一份实现。
// 三件事：只允许 http(s)；不访问内网地址（防 SSRF）；把 HTML 变成干净的文本并截断。
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface WebFetchOptions {
  /** 只允许这些域名（及其子域名）。不设置则允许所有公网域名。 */
  allowedDomains?: string[];
  /** 是否允许访问内网 / 本机地址。默认 false。 */
  allowPrivateHosts?: boolean;
  /** 即使是内网地址也放行的主机（比如本地开发服务器 127.0.0.1）。只列出你确定安全的。 */
  trustedHosts?: string[];
  maxBytes?: number;
  timeoutMs?: number;
}

/** 私有、回环、链路本地地址。169.254.169.254 是各大云平台的实例元数据服务，里面有临时凭证。 */
export function isPrivateAddress(ip: string): boolean {
  if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) return true;
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const [a, b] = v4.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** 在发请求之前检查 URL；返回拒绝原因，或 undefined 表示放行。 */
export async function checkUrl(raw: string, options: WebFetchOptions = {}): Promise<string | undefined> {
  let url: URL;
  try { url = new URL(raw); } catch { return `不是合法的 URL：${raw}`; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return `只支持 http 和 https，收到的是 ${url.protocol}`;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (options.allowedDomains?.length && !options.allowedDomains.some(d => host === d || host.endsWith(`.${d}`))) {
    return `域名 ${host} 不在允许列表里（${options.allowedDomains.join('、')}）`;
  }
  if (!options.allowPrivateHosts && !options.trustedHosts?.includes(host)) {
    // 解析出真实 IP 再判断：域名可以指向内网地址（DNS rebinding 的思路）
    const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map(a => a.address);
    if (addresses.length === 0) return `无法解析域名 ${host}`;
    const bad = addresses.find(isPrivateAddress);
    if (bad) return `拒绝访问内网地址 ${host}（${bad}）`;
  }
  return undefined;
}

/** 很粗糙但够用的 HTML → 文本：去掉脚本、样式和标签，保留段落换行。 */
export function htmlToText(html: string): { title?: string; text: string } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const text = html
    .replace(/<(script|style|noscript|svg|title)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|pre|section|article)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  return { title, text };
}

export interface FetchResult { url: string; status: number; contentType: string; title?: string; text: string; truncated: boolean }

export async function webFetch(url: string, options: WebFetchOptions = {}, signal?: AbortSignal): Promise<FetchResult> {
  const refusal = await checkUrl(url, options);
  if (refusal) throw new Error(refusal);
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 20_000);
  // 不自动跟随重定向：一个公网地址可以 302 到内网地址，每一跳都要重新检查
  let current = url;
  let response: Response | undefined;
  for (let hop = 0; hop < 5; hop++) {
    response = await fetch(current, { redirect: 'manual', signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: { 'user-agent': 'mox-web-fetch/1.0' } });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current).toString();
      const hopRefusal = await checkUrl(current, options);
      if (hopRefusal) throw new Error(`重定向被拒绝：${hopRefusal}`);
      continue;
    }
    break;
  }
  const contentType = response!.headers.get('content-type') ?? '';
  if (!/text\/|json|xml|javascript/.test(contentType)) throw new Error(`不支持的内容类型：${contentType || '未知'}`);
  const body = await response!.text();
  const maxBytes = options.maxBytes ?? 50 * 1024;
  const parsed = /html/.test(contentType) ? htmlToText(body) : { text: body };
  const truncated = Buffer.byteLength(parsed.text) > maxBytes;
  const text = truncated ? Buffer.from(parsed.text).subarray(0, maxBytes).toString('utf8') : parsed.text;
  return { url: current, status: response!.status, contentType, title: 'title' in parsed ? parsed.title : undefined, text, truncated };
}

export function formatResult(r: FetchResult): string {
  const head = [`URL: ${r.url}`, `状态: ${r.status}`, r.title ? `标题: ${r.title}` : ''].filter(Boolean).join('\n');
  return `${head}\n\n${r.text}${r.truncated ? '\n\n[内容过长，已截断]' : ''}`;
}
