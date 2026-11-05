// 第 8 章 token 估算实验用的三段文字：同样长度的中文、英文、代码。record.ts 拿它们去问真实的接口，replay.ts 拿它们算 mox 的估算。
export const probes: Record<string, string> = {
  '中文': '压缩不是删除历史，而是给历史写一份交接文档。'.repeat(80),
  '英文': 'Compaction does not delete history; it writes a handoff document for it. '.repeat(30),
  '代码': 'export function search(notes: string[], q: string) { return notes.filter(n => n.includes(q)); }\n'.repeat(22),
};
