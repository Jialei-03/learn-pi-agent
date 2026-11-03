// 本地假服务：把录制好的 SSE 流按固定字节数切碎后发回去。
// 切点故意不管行和字符的边界——一个中文字符（3 字节）也可能被切成两半——
// 用来证明解码器不依赖“一个网络包正好是一行”这种侥幸。
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

export interface MockOptions {
  chunkBytes?: number;
  fixtures?: { anthropic?: string; openai?: string };
  /** 只发送前 N 字节就断开连接，模拟网络中断 */
  cutAfterBytes?: number;
}

export async function startMock(options: MockOptions = {}) {
  const chunkBytes = options.chunkBytes ?? 7;
  const requests: { path: string; body: any }[] = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    requests.push({ path: req.url ?? '', body: JSON.parse(raw || '{}') });
    const name = new URL(req.url ?? '/', 'http://x').pathname.endsWith('/messages')
      ? (options.fixtures?.anthropic ?? 'anthropic-tool-call.sse')
      : (options.fixtures?.openai ?? 'openai-tool-call.sse');
    const bytes = fixture(name).subarray(0, options.cutAfterBytes);
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
