// 第 10 章实验的公共小工具：用“相邻两个字符”（bigram）衡量两段中文文字有多相似。
// 不需要分词，也不需要模型，足够演示“关键词检索”和“重复检测”的边界。
export const bigrams = (text: string): Set<string> => {
  const chars = [...text.toLowerCase().replace(/[\s，。、：；（）()[\]`'"“”—-]+/g, '')];
  return new Set(chars.slice(1).map((c, i) => chars[i] + c));
};

/** a 里的相邻字符对，有多大比例也出现在 b 里（0～1）。 */
export const overlap = (a: string, b: string) => {
  const left = bigrams(a);
  const right = bigrams(b);
  return left.size === 0 ? 0 : [...left].filter(x => right.has(x)).length / left.size;
};

/** 两段文字的 Jaccard 相似度：共有的 / 全部的。 */
export const jaccard = (a: string, b: string) => {
  const left = bigrams(a);
  const right = bigrams(b);
  const shared = [...left].filter(x => right.has(x)).length;
  return shared / (left.size + right.size - shared || 1);
};
