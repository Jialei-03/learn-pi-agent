// web_fetch 的核心逻辑（第 9 章）。Pi 扩展和 mox 的工具共用这一份实现。
// 三件事：只允许 http(s)；不访问内网地址（防 SSRF）；把 HTML 变成干净的文本并截断。
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

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

// 不能访问的地址段。169.254.169.254 是各大云平台的实例元数据服务，里面有临时凭证。
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) BLOCKED.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) BLOCKED.addSubnet(net, prefix, 'ipv6');

/** 把 IPv6 地址展开成 8 个 16 位整数。 */
function ipv6Groups(ip: string): number[] {
  let text = ip.toLowerCase();
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/);                       // ::ffff:1.2.3.4 这种写法
  if (dotted) {
    const [a, b, c, d] = dotted[1].split('.').map(Number);
    text = text.slice(0, -dotted[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail = ''] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = text.includes('::') && tail ? tail.split(':') : [];
  const middle = text.includes('::') ? Array(8 - left.length - right.length).fill('0') : [];
  return [...left, ...middle, ...right].map(g => parseInt(g || '0', 16));
}

/**
 * IPv6 地址里可能“藏着”一个 IPv4 地址：IPv4 映射地址（::ffff:a.b.c.d）和 NAT64（64:ff9b::a.b.c.d）。
 * 操作系统会把它们当成对应的 IPv4 地址去连接，所以必须按 IPv4 再检查一次。
 * 注意 Node 会把 [::ffff:169.254.169.254] 规范化成十六进制的 ::ffff:a9fe:a9fe，只按点分十进制匹配会漏掉。
 */
function embeddedIPv4(ip: string): string | undefined {
  const g = ipv6Groups(ip);
  const mapped = g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff;
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0);
  if (!mapped && !nat64) return undefined;
  return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.');
}

/** 私有、回环、链路本地、保留地址都算“内网”。解析不了的地址也一律拒绝。 */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 0) return true;
  if (kind === 6) {
    const v4 = embeddedIPv4(ip);
    if (v4) return isPrivateAddress(v4);
    return BLOCKED.check(ip, 'ipv6');
  }
  return BLOCKED.check(ip, 'ipv4');
}

const isTrusted = (host: string, options: WebFetchOptions) => options.allowPrivateHosts || !!options.trustedHosts?.includes(host);

/** 在发请求之前检查 URL；返回拒绝原因，或 undefined 表示放行。给模型一个清楚的拒绝理由。 */
export async function checkUrl(raw: string, options: WebFetchOptions = {}): Promise<string | undefined> {
  let url: URL;
  try { url = new URL(raw); } catch { return `不是合法的 URL：${raw}`; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return `只支持 http 和 https，收到的是 ${url.protocol}`;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (options.allowedDomains?.length && !options.allowedDomains.some(d => host === d || host.endsWith(`.${d}`))) {
    return `域名 ${host} 不在允许列表里（${options.allowedDomains.join('、')}）`;
  }
  if (!isTrusted(host, options)) {
    // 解析出真实 IP 再判断：域名可以指向内网地址
    const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map(a => a.address);
    if (addresses.length === 0) return `无法解析域名 ${host}`;
    const bad = addresses.find(isPrivateAddress);
    if (bad) return `拒绝访问内网地址 ${host}（${bad}）`;
  }
  return undefined;
}

/**
 * 连接时的 DNS 解析：每次真正建立连接前，再检查一遍解析出的地址。
 * checkUrl 里解析过一次，但真正连接时还会再解析一次；攻击者控制的域名可以第一次返回公网 IP、
 * 第二次返回内网 IP（DNS rebinding）。把检查放进连接用的 lookup，检查的就是实际连接的那个地址。
 */
function guardedLookup(host: string, options: WebFetchOptions): LookupFunction {
  return (hostname, lookupOptions, callback) => {
    dnsLookup(hostname, { ...lookupOptions, all: true }, (error, addresses) => {
      if (error) return callback(error, '', 0);
      const list = addresses as unknown as LookupAddress[];
      const bad = isTrusted(host, options) ? undefined : list.find(a => isPrivateAddress(a.address));
      if (bad) return callback(Object.assign(new Error(`拒绝连接内网地址 ${hostname}（${bad.address}）`), { code: 'EPRIVATEADDR' }), '', 0);
      if (lookupOptions.all) (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
      else callback(null, list[0].address, list[0].family);
    });
  };
}

/** 发一次 GET，不跟随重定向，最多读 limit 字节。 */
function get(url: URL, options: WebFetchOptions, signal: AbortSignal, limit: number) {
  return new Promise<{ status: number; headers: IncomingMessage['headers']; body: string }>((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(url, { method: 'GET', signal, lookup: guardedLookup(host, options), headers: { 'user-agent': 'mox-web-fetch/1.0' } }, res => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size <= limit) chunks.push(chunk);
        else res.destroy();                                              // 读够了就断开，不把整个大文件读进内存
      });
      res.on('close', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
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
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const maxBytes = options.maxBytes ?? 50 * 1024;
  // 不自动跟随重定向：一个公网地址可以 302 到内网地址，每一跳都要重新检查
  let current = url;
  let response: Awaited<ReturnType<typeof get>> | undefined;
  for (let hop = 0; hop < 5; hop++) {
    try {
      response = await get(new URL(current), options, combined, maxBytes * 8);
    } catch (error) {
      if ((error as { code?: string }).code === 'EPRIVATEADDR') throw new Error(`拒绝访问：${(error as Error).message}`);
      throw error;
    }
    const location = response.headers.location;
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current).toString();
      const hopRefusal = await checkUrl(current, options);
      if (hopRefusal) throw new Error(`重定向被拒绝：${hopRefusal}`);
      continue;
    }
    break;
  }
  const contentType = String(response!.headers['content-type'] ?? '');
  if (!/text\/|json|xml|javascript/.test(contentType)) throw new Error(`不支持的内容类型：${contentType || '未知'}`);
  const parsed = /html/.test(contentType) ? htmlToText(response!.body) : { text: response!.body };
  const truncated = Buffer.byteLength(parsed.text) > maxBytes;
  const text = truncated ? Buffer.from(parsed.text).subarray(0, maxBytes).toString('utf8') : parsed.text;
  return { url: current, status: response!.status, contentType, title: 'title' in parsed ? parsed.title : undefined, text, truncated };
}

export function formatResult(r: FetchResult): string {
  const head = [`URL: ${r.url}`, `状态: ${r.status}`, r.title ? `标题: ${r.title}` : ''].filter(Boolean).join('\n');
  return `${head}\n\n${r.text}${r.truncated ? '\n\n[内容过长，已截断]' : ''}`;
}
