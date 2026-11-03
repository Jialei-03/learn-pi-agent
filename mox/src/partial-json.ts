// 不完整 JSON 的预览（第 2 章）。
// 流式工具调用的参数是一段一段到达的：'{"pa' → 'th": "src/' → 'cli.ts"}'。
// 为了让界面提前显示“正在读 src/…”，我们把缺的引号和括号补上再解析。
// 注意：预览只用于显示。参数完整之前，绝不能拿它去执行工具。

export function previewJson(text: string): Record<string, unknown> | undefined {
  const closers: string[] = [];
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') closers.push('}');
    else if (char === '[') closers.push(']');
    else if (char === '}' || char === ']') closers.pop();
  }
  let repaired = text;
  if (escaped) repaired = repaired.slice(0, -1);         // 去掉悬空的反斜杠
  if (inString) repaired += '"';
  if (closers.at(-1) === '}') repaired = repaired.replace(/([{,])\s*"[^"]*"\s*(:\s*)?$/, '$1'); // 只有键、还没有值
  repaired = repaired.replace(/,\s*$/, '');
  try {
    const value = JSON.parse(repaired + closers.reverse().join(''));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 解析完整的参数文本。失败时不抛异常，而是返回错误说明：
 * 输出被截断（stopReason = length）时，参数本来就可能只有半截，交给循环决定怎么处理。
 */
export function parseArguments(json: string): { value: Record<string, unknown>; error?: string } {
  if (!json.trim()) return { value: {} };
  try {
    const value = JSON.parse(json);
    if (value && typeof value === 'object' && !Array.isArray(value)) return { value };
    return { value: {}, error: `参数不是 JSON 对象：${json}` };
  } catch {
    return { value: {}, error: `参数不是合法 JSON：${json}` };
  }
}
