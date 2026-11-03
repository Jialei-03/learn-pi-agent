// 沙箱的网络出口（第 15 章）：沙箱里的命令只能连这个本地代理，代理按域名白名单决定放不放行。
// 它运行在沙箱外面（Agent 进程里），自己的出站连接不受沙箱限制。
// 支持两种请求：HTTPS 用 CONNECT 建隧道（代理只看得到域名，看不到内容）；HTTP 是完整 URL 的普通请求。
import { createServer, request } from 'node:http';
import { connect, type AddressInfo } from 'node:net';

export interface ProxyDecision { host: string; allowed: boolean }

/** example.com 匹配 example.com；*.example.com 匹配它的所有子域名 */
export function hostAllowed(host: string, allowed: string[]): boolean {
  return allowed.some(d => (d.startsWith('*.') ? host.endsWith(d.slice(1)) : host === d));
}

export async function startProxy(allowed: string[], onDecision: (d: ProxyDecision) => void = () => {}) {
  const server = createServer((req, res) => {
    let url: URL;
    try { url = new URL(req.url ?? ''); } catch { res.writeHead(400).end(); return; }
    const ok = hostAllowed(url.hostname, allowed);
    onDecision({ host: url.hostname, allowed: ok });
    if (!ok) { res.writeHead(403, { 'content-type': 'text/plain' }).end(`沙箱代理拒绝访问 ${url.hostname}：不在允许的域名列表里\n`); return; }
    const upstream = request({ host: url.hostname, port: url.port || 80, path: url.pathname + url.search, method: req.method, headers: req.headers }, up => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    upstream.on('error', e => res.writeHead(502).end(e.message));
    req.pipe(upstream);
  });
  server.on('connect', (req, socket, head) => {
    const [host, port] = (req.url ?? '').split(':');
    const ok = hostAllowed(host, allowed);
    onDecision({ host, allowed: ok });
    if (!ok) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const upstream = connect(Number(port) || 443, host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.end());
    socket.on('error', () => upstream.destroy());
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}
