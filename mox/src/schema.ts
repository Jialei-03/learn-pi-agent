// 极简 JSON Schema 校验（第 4 章）。
// 只支持工具参数里最常见的几个关键字：type、properties、required、additionalProperties、enum、items、minimum、maximum。
// 重点不在“支持多少关键字”，而在错误信息：它是写给模型看的，要让模型下一轮能自己改对。
// 对照 Pi：packages/ai/src/utils/validation.ts（validateToolArguments）。

export type Schema = {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: unknown[];
  items?: Schema;
  minimum?: number;
  maximum?: number;
};

export interface SchemaError { path: string; message: string }

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer';
  return typeof value;
}

/**
 * 宽进：先把“明显无害”的格式错误修正掉，省一次来回。
 * 模型常把数字写成字符串（"20"）、把布尔写成字符串（"true"）、把单个值当数组、给可选参数传 null。
 * 修不了的（比如 "abc" 要当整数）原样保留，交给 validate 报错。
 */
export function coerce(schema: Schema, value: unknown): unknown {
  if (schema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const sub = schema.properties?.[key];
      if (child === null && sub && !schema.required?.includes(key)) continue;   // 可选参数传了 null：当作没传
      out[key] = sub ? coerce(sub, child) : child;
    }
    return out;
  }
  if ((schema.type === 'number' || schema.type === 'integer') && typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n) && (schema.type === 'number' || Number.isInteger(n))) return n;
  }
  if (schema.type === 'boolean' && (value === 'true' || value === 'false')) return value === 'true';
  if (schema.type === 'string' && (typeof value === 'number' || typeof value === 'boolean')) return String(value);
  if (schema.type === 'array' && value !== undefined && !Array.isArray(value)) return [schema.items ? coerce(schema.items, value) : value];
  if (schema.type === 'array' && Array.isArray(value) && schema.items) return value.map(v => coerce(schema.items!, v));
  return value;
}

/** 严出：修正之后仍然不符合的，逐条列出来。 */
export function validate(schema: Schema, value: unknown, path = ''): SchemaError[] {
  const errors: SchemaError[] = [];
  const at = path || '（根）';
  if (schema.type) {
    const actual = typeOf(value);
    const ok = actual === schema.type || (schema.type === 'number' && actual === 'integer');
    if (!ok) return [{ path: at, message: `应为 ${schema.type}，实际是 ${actual}` }];
  }
  if (schema.enum && !schema.enum.some(v => v === value)) {
    errors.push({ path: at, message: `只能是 ${schema.enum.map(v => JSON.stringify(v)).join(' / ')} 之一` });
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path: at, message: `不能小于 ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path: at, message: `不能大于 ${schema.maximum}` });
  }
  if (schema.type === 'array' && schema.items && Array.isArray(value)) {
    value.forEach((item, i) => errors.push(...validate(schema.items!, item, `${path}[${i}]`)));
  }
  if (schema.type === 'object' && value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in object)) errors.push({ path: path ? `${path}.${key}` : key, message: '缺少必填参数' });
    }
    for (const [key, child] of Object.entries(object)) {
      const sub = schema.properties?.[key];
      const childPath = path ? `${path}.${key}` : key;
      if (sub) errors.push(...validate(sub, child, childPath));
      else if (schema.additionalProperties === false) errors.push({ path: childPath, message: '不认识这个参数' });
    }
  }
  return errors;
}

/** 校验失败时抛出的错误信息：列出每一处问题，再附上模型实际发来的参数。 */
export function formatValidationError(toolName: string, errors: SchemaError[], args: unknown) {
  return [
    `工具 ${toolName} 的参数校验失败：`,
    ...errors.map(e => `  - ${e.path}：${e.message}`),
    '',
    '收到的参数：',
    JSON.stringify(args, null, 2),
  ].join('\n');
}
