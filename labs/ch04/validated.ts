// 「你来改」的参考实现：给 mox 的工具补上“宽进严出”的参数校验。
// mox 本身不校验（loop.ts 只做 JSON.parse），所以这里不改 mox，而是给每个工具的 run 包一层：
// 先修正意图毫无歧义的小错误（宽进），再按 JSON Schema 严格检查（严出），不合格就抛错，
// 错误信息会被 mox 的 execute 变成“错误：……”交回模型。
type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean; minimum?: number };

/** 宽进：字符串 "20" → 数字 20，"true" → true，可选参数传 null 当作没传。修不了的原样留给校验。 */
function coerce(value: any, schema: Schema | undefined): any {
  if (value === null || !schema) return value;
  if ((schema.type === 'number' || schema.type === 'integer') && typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
  if (schema.type === 'boolean' && (value === 'true' || value === 'false')) return value === 'true';
  return value;
}

const typeOf = (v: unknown) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
const fits = (v: unknown, type?: string) =>
  !type || typeOf(v) === type || (type === 'integer' && Number.isInteger(v)) || (type === 'number' && typeof v === 'number');

/** 返回修正后的参数；有问题就抛出一条写给模型看的错误：哪个参数、错在哪、实际收到了什么。 */
export function validate(name: string, args: any, schema: Schema): any {
  const input = structuredClone(args ?? {});                       // 先复制，不改动历史里那条调用
  const issues: string[] = [];
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(input)) {
    const prop = schema.properties?.[key];
    if (!prop) { if (schema.additionalProperties === false) issues.push(`  - ${key}: 不认识这个参数`); continue; }
    if (value === null && !schema.required?.includes(key)) continue; // 可选参数传 null = 没传
    const fixed = coerce(value, prop);
    if (!fits(fixed, prop.type)) issues.push(`  - ${key}: 应该是 ${prop.type}，收到 ${JSON.stringify(value)}`);
    else if (prop.minimum !== undefined && typeof fixed === 'number' && fixed < prop.minimum) issues.push(`  - ${key}: 不能小于 ${prop.minimum}`);
    else out[key] = fixed;
  }
  for (const key of schema.required ?? []) if (!(key in out) && !issues.some(i => i.startsWith(`  - ${key}:`))) issues.push(`  - ${key}: 缺少必填参数`);
  if (issues.length) throw new Error(`${name} 的参数不合法：\n${issues.join('\n')}\n\n收到的参数：\n${JSON.stringify(args, null, 2)}`);
  return out;
}

/** 给一组工具统一加上校验。 */
export const withValidation = <T extends { name: string; parameters: object; run: (args: any, signal?: AbortSignal) => any }>(tools: T[]): T[] =>
  tools.map(tool => ({ ...tool, run: (args: any, signal?: AbortSignal) => tool.run(validate(tool.name, args, tool.parameters as Schema), signal) }));
