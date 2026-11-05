// 第 18 章实验：效果三明治——崩溃发生在哪个位置，恢复时会发生什么。
//   node labs/ch18/sandwich.ts
// 一个最小的“持久执行”模型（不是 Pi 的代码，只复刻它的记录方式）：每个工具调用在存储里最多留下三种记录——
//   call（助手发出了调用）、intent（执行前写下的意图）、result（执行后写下的结果）。
// “崩溃”= 在某个位置抛出异常，内存里的一切都丢掉，只剩存储；外部世界（部署了几次）不受崩溃影响。恢复时只能读存储。
// 四种恢复策略：朴素重放（第 18 章开头）、一律中断（最简单的做法：只看会话记录，没有结果的调用一律写“中断”，实战里的 mox 就是这样）、
// 声明重放安全（Pi durable 的规则：声明过的工具直接重跑，其余写“中断”）、三明治（Pi durable：先写 intent）。
import assert from 'node:assert/strict';

type Rec = { kind: 'call' | 'intent' | 'result'; id: string; text?: string };
type Strategy = 'naive' | 'mox' | 'declared' | 'sandwich';
type CrashAt = 'beforeTool' | 'afterIntent' | 'afterEffect';

class Crash extends Error {}
const INTERRUPTED = '中断';

/** 外部世界：崩溃抹不掉这里发生过的事 */
const world = { runs: 0, applied: new Set<string>() };
interface Tool { replaySafe: boolean; run(callId: string, key?: string): string }
const tools: Record<string, Tool> = {
  // 读文件：执行多少遍结果都一样
  read: { replaySafe: true, run: () => { world.runs++; return '# README'; } },
  // 部署：每次执行都在外部世界留下一次部署；带幂等键时，同一个键只生效一次
  deploy: { replaySafe: false, run: (callId, key) => { world.runs++; world.applied.add(key ?? `${callId}#${world.runs}`); return '部署完成'; } },
};

function execute(strategy: Strategy, store: Rec[], tool: string, key: string | undefined, crashAt?: CrashAt) {
  store.push({ kind: 'call', id: 'c1' });                       // 助手消息写进存储，调用 c1 还没有结果
  if (crashAt === 'beforeTool') throw new Crash();
  if (strategy === 'sandwich') store.push({ kind: 'intent', id: 'c1' });    // 三明治的上半片：先写意图
  if (crashAt === 'afterIntent') throw new Crash();
  const text = tools[tool].run('c1', key);
  if (crashAt === 'afterEffect') throw new Crash();             // 效果已经发生，结果还没写下
  store.push({ kind: 'result', id: 'c1', text });               // 三明治的下半片
}

/** 重启之后：只看存储，决定怎么处理没有结果的调用 */
function recover(strategy: Strategy, store: Rec[], tool: string, key: string | undefined): string {
  if (store.some(r => r.kind === 'result')) return '无需恢复';
  const intent = store.some(r => r.kind === 'intent');
  const replay = () => { store.push({ kind: 'result', id: 'c1', text: tools[tool].run('c1', key) }); };
  const interrupt = () => { store.push({ kind: 'result', id: 'c1', text: INTERRUPTED }); return `写“${INTERRUPTED}”`; };
  if (strategy === 'naive') { replay(); return '重放'; }
  if (strategy === 'mox') return interrupt();                                   // 一律中断：不区分，一律“中断”
  if (strategy === 'sandwich' && !intent) { replay(); return '首次执行'; }     // 没有 intent：工具肯定还没开始
  if (tools[tool].replaySafe) { replay(); return '重放'; }                      // 声明了重放安全：直接再执行
  return interrupt();                                                           // 否则如实告诉模型：不知道有没有生效
}

function trial(strategy: Strategy, tool: string, crashAt: CrashAt, key?: string) {
  world.runs = 0;
  world.applied.clear();
  const store: Rec[] = [];
  try { execute(strategy, store, tool, key, crashAt); } catch (error) { if (!(error instanceof Crash)) throw error; }
  const how = recover(strategy, store, tool, key);
  return { how, runs: world.runs, effects: world.applied.size, text: store.find(r => r.kind === 'result')?.text };
}

const points: [CrashAt, string][] = [
  ['beforeTool', '① 调用已记录，工具还没开始'],
  ['afterIntent', '② 意图已写，工具刚要开始'],
  ['afterEffect', '③ 工具跑完了，结果没来得及写'],
];
const strategies: [Strategy, string][] = [['naive', '朴素重放'], ['mox', '一律中断'], ['declared', '声明重放安全'], ['sandwich', '效果三明治']];

console.log('| 工具 | 崩溃位置 | ' + strategies.map(s => s[1]).join(' | ') + ' |');
console.log('| --- | --- | --- | --- | --- | --- |');
const grid: Record<string, ReturnType<typeof trial>> = {};
for (const [label, tool, key] of [['read（只读）', 'read', undefined], ['deploy（有副作用）', 'deploy', undefined], ['deploy + 幂等键', 'deploy', 'v2']] as const) {
  for (const [crashAt, where] of points) {
    const cells = strategies.map(([strategy]) => {
      const r = trial(strategy, tool, crashAt, key);
      grid[`${label}|${crashAt}|${strategy}`] = r;
      return `${r.how}：执行 ${r.runs} 次，生效 ${r.effects} 次`;
    });
    console.log(`| ${label} | ${where} | ${cells.join(' | ')} |`);
  }
}

console.log(`
读表的四个要点：
  · deploy 的第 ③ 行：朴素重放生效了 2 次（事故）；其余三种都只生效 1 次，并告诉模型“中断了”，让它去查证。
  · read 的几行是“一律中断”的代价：读文件重放无害，它不区分，也写“中断”，模型要多花一轮把文件再读一遍。“声明重放安全”就是为了省掉这一轮。
  · 三明治只改善了第 ① 行：没有 intent 就说明工具肯定没开始，可以放心首次执行，模型不必多花一轮去查证。
  · 第 ② 和 ③ 行无法区分：intent 已经写下，但不知道工具有没有开始。这一段窗口不可能关闭，只能靠“重放安全”或“幂等键”兜底。`);

// 正文的结论
const at = (label: string, crashAt: CrashAt, strategy: Strategy) => grid[`${label}|${crashAt}|${strategy}`];
assert.equal(at('deploy（有副作用）', 'afterEffect', 'naive').effects, 2, '朴素重放：部署生效两次');
for (const strategy of ['mox', 'declared', 'sandwich'] as const) {
  const r = at('deploy（有副作用）', 'afterEffect', strategy);
  assert.deepEqual([r.effects, r.text], [1, INTERRUPTED], `${strategy}：部署只生效一次，模型收到“中断”`);
}
assert.deepEqual([at('deploy（有副作用）', 'beforeTool', 'mox').effects, at('deploy（有副作用）', 'beforeTool', 'mox').text], [0, INTERRUPTED], '一律中断：无法区分“没开始”，只能写“中断”');
assert.deepEqual([at('deploy（有副作用）', 'beforeTool', 'declared').effects, at('deploy（有副作用）', 'beforeTool', 'declared').text], [0, INTERRUPTED], '声明重放安全帮不了 deploy：它没有这个声明');
assert.deepEqual([at('deploy（有副作用）', 'beforeTool', 'sandwich').effects, at('deploy（有副作用）', 'beforeTool', 'sandwich').text], [1, '部署完成'], '三明治：没有 intent，直接首次执行');
assert.equal(at('deploy（有副作用）', 'afterIntent', 'sandwich').text, INTERRUPTED, '有 intent 但没有结果：窗口无法关闭');
assert.equal(at('deploy + 幂等键', 'afterEffect', 'naive').runs, 2, '带幂等键：朴素重放仍然会执行两次……');
assert.equal(at('deploy + 幂等键', 'afterEffect', 'naive').effects, 1, '……但只生效一次');
for (const [crashAt] of points) {
  for (const [strategy] of strategies) {
    const r = at('read（只读）', crashAt, strategy);
    // 读文件在任何位置都没有副作用；除了一律中断把它也写成“中断”，其余策略都能直接重放
    assert.deepEqual([r.text, r.effects], [strategy === 'mox' ? INTERRUPTED : '# README', 0], `read（${strategy}，${crashAt}）`);
  }
}
