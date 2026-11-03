// Server-Sent Events 解码器（第 2 章）。
// 流式响应是一串文本行：`event: xxx`、`data: {...}`，空行表示一个事件结束。
// 网络包的边界和行的边界没有关系：一个 chunk 可能只有半行，也可能有好几个事件。

export interface ServerSentEvent { event?: string; data: string }

export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<ServerSentEvent> {
  const decoder = new TextDecoder();      // stream: true 让多字节字符（比如中文）跨 chunk 时不被切坏
  let buffer = '';
  let event: string | undefined;
  let data: string[] = [];
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      if (line === '') {                                   // 空行：一个事件结束
        if (data.length > 0) yield { event, data: data.join('\n') };
        event = undefined;
        data = [];
      } else if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      // 以冒号开头的是注释（心跳），其他字段这里用不到，直接忽略
    }
  }
  if (data.length > 0) yield { event, data: data.join('\n') };
}
