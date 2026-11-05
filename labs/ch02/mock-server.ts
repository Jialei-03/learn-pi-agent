// 本地假服务：把离线 SSE 样本按固定字节数切碎后发回去。
// 切点故意不管行和字符的边界——一个中文字符（3 字节）也可能被切成两半——
// 用来证明解码器不依赖“一个网络包正好是一行”这种侥幸。
// 路径以 /messages 结尾的请求回 Anthropic 样本，其余回 OpenAI 样本。
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL(name, import.meta.url));

export interface MockOptions {
  chunkBytes?: number;
  /** 样本文件，相对于 labs/ch02/ */
  files?: { anthropic?: string; openai?: string };
  /** 只发送前 N 字节就正常结束连接（服务端提前收尾，或者中间的代理把流截断了） */
  cutAfterBytes?: number;
  /** 不发样本，直接返回这个 HTTP 状态码和一小段错误正文 */
  status?: number;
}

export async function startMock(options: MockOptions = {}) {
  const chunkBytes = options.chunkBytes ?? 7;
  const requests: { path: string; body: any }[] = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    requests.push({ path: req.url ?? '', body: JSON.parse(raw || '{}') });
    if (options.status) {
      res.writeHead(options.status, { 'content-type': 'application/json' });
      return void res.end(JSON.stringify({ error: { message: options.status === 429 ? 'rate limit exceeded' : 'server error' } }));
    }
    const anthropic = new URL(req.url ?? '/', 'http://x').pathname.endsWith('/messages');
    const bytes = read(anthropic ? (options.files?.anthropic ?? 'fixtures/anthropic-tool-call.sse') : (options.files?.openai ?? 'fixtures/openai-tool-call.sse')).subarray(0, options.cutAfterBytes);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (let i = 0; i < bytes.length; i += chunkBytes) {
      res.write(bytes.subarray(i, i + chunkBytes));
      await new Promise(r => setImmediate(r));               // 让每一片成为单独的网络写入
    }
    res.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise(r => server.close(r)) };
}
