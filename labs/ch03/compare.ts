// 第 3 章实验：同一份脚本，两种循环。
//   node labs/ch03/compare.ts            全部情形
//   node labs/ch03/compare.ts truncated  只跑一个
// v0 是把保护全部拿掉的稻草人，不是另一个 Agent；Pi 是真实的 runAgentLoop，模型换成 Pi 的 faux provider。
import { compact, naive, pi } from './runners.ts';
import { scenarios, type Observation } from './scenarios.ts';

// ── 打印 ─────────────────────────────────────────────────────

export async function compareAll(names = Object.keys(scenarios)) {
  const out: Record<string, Record<string, Observation>> = {};
  for (const name of names) {
    const s = scenarios[name];
    out[name] = { v0: await naive(s), Pi: await pi(s) };
    if (s.stopAfter) out[name][`Pi + finishTurn`] = await pi(s, true);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pick = process.argv[2];
  if (pick && !scenarios[pick]) throw new Error(`未知情形：${pick}。可选：${Object.keys(scenarios).join('、')}`);
  const all = await compareAll(pick ? [pick] : undefined);
  for (const [name, cols] of Object.entries(all)) {
    console.log(`\n## ${scenarios[name].title}\n`);
    const rows: [string, (o: Observation) => string][] = [
      ['模型请求次数', o => String(o.requests)],
      ['工具实际执行', o => compact(o.toolRuns)],
      ['结局', o => o.outcome],
    ];
    if (Object.values(cols).some(o => o.install !== undefined)) rows.push(['磁盘上的 INSTALL.md', o => JSON.stringify(o.install ?? null)]);
    if (Object.values(cols).some(o => o.unread.length)) rows.push(['没被读到的插话', o => o.unread.join('，') || '无']);
    console.log(`| | ${Object.keys(cols).join(' | ')} |\n| --- | ${Object.keys(cols).map(() => '---').join(' | ')} |`);
    for (const [label, pick] of rows) console.log(`| ${label} | ${Object.values(cols).map(pick).join(' | ')} |`);
  }
}
