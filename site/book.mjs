// 书本式导航：三门课共用（learn-pi-agent、learn-claude-code、learn-minimax-code 各有一份相同的拷贝）。
//   · 左侧课程目录是“章 → 节”两级树：当前章展开并列出带编号的小节，其他章折叠；
//   · 正文的二、三级标题加上编号（3.1、3.1.1），右侧“目录”用同一套编号；
//   · 插图和流程图按章编号（图 3-1），没有说明文字的流程图用所在小节的标题当说明。
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 线条图标（24×24，描边）。按章节 slug 里的关键词挑一个。
const ICON_PATHS = {
  book: "M2 5h7a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H2zM22 5h-7a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h8z",
  loop: "M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
  wrench: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6",
  archive: "M3 4h18v4H3zM5 8v12h14V8M10 12h4",
  shield: "M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5z",
  link: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
  plug: "M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4",
  sparkles: "M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8zM19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z",
  users: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6",
  box: "M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  terminal: "M4 17l6-5-6-5M12 19h8",
  layers: "M12 2l10 5-10 5L2 7zM2 12l10 5 10-5M2 17l10 5 10-5",
  branch: "M6 3v12M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9c0 6-12 3-12 9",
  cpu: "M6 6h12v12H6zM9 9h6v6H9zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  gauge: "M12 14l4-4M3.3 19a10 10 0 1 1 17.4 0",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  map: "M9 3 3 6v15l6-3 6 3 6-3V3l-6 3zM9 3v15M15 6v15",
  door: "M3 21h18M6 21V3h12v18M14 12h.01",
  camera: "M3 7h4l2-3h6l2 3h4v13H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  check: "M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2",
  pulse: "M3 12h4l3-8 4 16 3-8h4",
  puzzle: "M10 3h4v3a2 2 0 1 0 4 0V3h3v7h-3a2 2 0 1 0 0 4h3v7h-7v-3a2 2 0 1 0-4 0v3H3v-7h3a2 2 0 1 0 0-4H3V3h7z",
  code: "M8 6l-6 6 6 6M16 6l6 6-6 6",
  stream: "M4 6h16M4 12h10M4 18h6M18 16l2 2-2 2",
};
const ICON_RULES = [
  [/course-map|00-method|method|reading/, "book"], [/from-api|one-run|agent-loop/, "loop"], [/model|protocol/, "cpu"],
  [/request/, "send"], [/coding-tools/, "code"], [/tool/, "wrench"], [/context/, "camera"], [/memory/, "file"],
  [/session|history|compaction/, "archive"], [/extension/, "puzzle"], [/skill/, "sparkles"], [/mcp|plugin/, "plug"],
  [/hook/, "link"], [/permission/, "shield"], [/sandbox/, "box"], [/plan|todo|checkpoint/, "check"],
  [/subagent/, "users"], [/long-running/, "clock"], [/queue/, "list"], [/sdk|headless|rpc|event/, "stream"],
  [/eval/, "gauge"], [/architecture/, "door"], [/turn/, "pulse"], [/contribution/, "branch"],
  [/capstone|synthesis|comparison/, "layers"],
];
export function iconFor(slug) {
  const name = ICON_RULES.find(([re]) => re.test(slug))?.[1] ?? "book";
  return `<svg class="nav-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="${ICON_PATHS[name]}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/**
 * 给一章渲染好的 HTML 加编号。
 * headings：[{ level: 2|3, id, text }]（顶层正文里的标题）。返回带 num 字段的新 headings。
 */
export function numberChapter(html, n, headings) {
  const ids = new Set(headings.map((h) => h.id));
  let h2 = 0, h3 = 0;
  const numbered = headings.map((h) => {
    if (h.level === 2) { h2++; h3 = 0; return { ...h, num: `${n}.${h2}` }; }
    h3++;
    return { ...h, num: `${n}.${h2}.${h3}` };
  });
  const numOf = new Map(numbered.map((h) => [h.id, h.num]));
  // 标题前加编号
  html = html.replace(/<h([23]) id="([^"]+)"([^>]*)>/g, (all, level, id, rest) =>
    ids.has(id) ? `<h${level} id="${id}"${rest}><span class="h-num">${numOf.get(id)}</span>` : all);
  // 图编号：插图、手绘图、流程图按出现顺序编号；流程图没有说明时，借用所在小节的标题
  let fig = 0;
  let section = "";
  html = html.replace(/<h[23] id="([^"]+)"[^>]*>[\s\S]*?<\/h[23]>|(<figure class="(?:figure|diagram[^"]*|stepper-figure)"[\s\S]*?)(<figcaption>)([\s\S]*?)(<\/figcaption>)/g,
    (all, headId, before, open, caption, close) => {
      if (headId) { section = numbered.find((h) => h.id === headId)?.text ?? section; return all; }
      fig++;
      const text = /机制图|示意图|点击放大|分步演示/.test(caption) ? esc(section) : caption;
      return `${before}${open}<span class="fig-num">图 ${n}-${fig}</span>${text}${close}`;
    });
  return { html, headings: numbered };
}

/** 右侧“目录”。 */
export function bookToc(headings) {
  if (!headings.length) return "";
  return `<aside class="toc" aria-label="本页目录"><div class="toc-inner"><div class="toc-title">目录</div><ol>${headings
    .map((h) => `<li class="lvl-${h.level}"><a href="#${h.id}"><span class="toc-num">${h.num ?? ""}</span><span>${esc(h.text)}</span></a></li>`)
    .join("")}</ol></div></aside>`;
}

/**
 * 左侧课程目录。
 *   parts：[{ title, chapters: [{ n, slug, title }] }]
 *   sections：Map(slug → 带编号的 h2 列表)
 *   current：当前章节 slug（首页等页面为 undefined）
 *   href：(slug, id?) => 链接
 */
export function bookSidebar({ parts, sections, current, href, footer = "" }) {
  const groups = parts.map((part) => `<div class="nav-part"><div class="nav-part-title">${esc(part.title)}</div><ul class="nav-chapters">${part.chapters
    .map((c) => {
      const open = c.slug === current;
      const subs = (sections.get(c.slug) ?? []).filter((h) => h.level === 2);
      const short = c.title.split("：")[0];
      return `<li class="nav-ch${open ? " open current" : ""}" data-slug="${c.slug}">
<div class="nav-ch-row"><a class="nav-ch-link" href="${href(c.slug)}"${open ? ' aria-current="page"' : ""} title="${esc(c.title)}">${iconFor(c.slug)}<span class="nav-ch-num">第 ${c.n} 章</span><span class="nav-ch-title">${esc(short)}</span></a>${subs.length ? `<button class="nav-ch-toggle" type="button" aria-label="展开或收起第 ${c.n} 章" aria-expanded="${open}"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : ""}</div>
${subs.length ? `<ul class="nav-sections">${subs.map((h) => `<li><a href="${href(c.slug, h.id)}" data-id="${h.id}"><span class="nav-sec-num">${h.num}</span><span>${esc(h.text)}</span></a></li>`).join("")}</ul>` : ""}
</li>`;
    })
    .join("")}</ul></div>`).join("");
  return `<nav class="sidebar" aria-label="课程目录"><div class="sidebar-inner">${groups}${footer}</div></nav>`;
}

// ───────── 分步动画图 ─────────
// 正文写法：
//   ::: steps 图的说明
//   --- 第一步的说明（可以用 Markdown 行内语法）
//   flowchart LR
//     A[收到调用] --> B[校验]:::on
//   --- 第二步的说明
//   ...
//   :::
// 每一步是一张 mermaid 图；flowchart 里给节点加 :::on 表示“这一步正在发生”（自动定义好高亮样式），:::done 表示已经过去。
const STEP_CLASSES = [
  "  classDef on fill:#ffe6d5,stroke:#f0601c,stroke-width:2.5px,color:#7c2d12",
  "  classDef done fill:#eef6ee,stroke:#6aa86a,color:#2f5f2f",
  "  classDef dim fill:#f4f4f5,stroke:#d4d4d8,color:#a1a1aa",
].join("\n");
export function parseSteps(text) {
  const frames = [];
  for (const line of text.split("\n")) {
    const head = line.match(/^---\s*(.*)$/);
    if (head) { frames.push({ note: head[1], mermaid: "" }); continue; }
    if (frames.length) frames.at(-1).mermaid += line + "\n";
  }
  return frames.map((f) => ({ note: f.note, mermaid: f.mermaid.trimEnd() }));
}
const inlineMd = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
export function renderSteps(title, frames) {
  const body = frames.map((f) => {
    const src = /^(flowchart|graph)\b/m.test(f.mermaid) && !/classDef on\b/.test(f.mermaid) ? `${f.mermaid}\n${STEP_CLASSES}` : f.mermaid;
    return `<div class="stepper-frame" data-note="${esc(inlineMd(f.note))}"><pre class="mermaid">${esc(src)}</pre></div>`;
  }).join("");
  const btn = (act, label, path) => `<button type="button" data-act="${act}" aria-label="${label}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  return `<figure class="stepper-figure"><div class="stepper" tabindex="0"><div class="stepper-stage">${body}<span class="stepper-badge"></span></div><p class="stepper-note"></p><div class="stepper-bar"><button type="button" data-act="play" aria-label="播放"></button><span class="stepper-dots"></span><span class="stepper-count"></span>${btn("prev", "上一步", "M19 12H5M11 6l-6 6 6 6")}${btn("next", "下一步", "M5 12h14M13 6l6 6-6 6")}</div></div>${title ? `<figcaption>${esc(title)}</figcaption>` : "<figcaption>分步演示</figcaption>"}</figure>`;
}

// ───────── 代码标签页 ─────────
// 正文写法：
//   ::: tabs
//   @@ Claude Code
//   @cc services/tools/toolOrchestration.ts#partitionToolCalls
//   @@ Pi
//   @pi packages/agent/src/agent-loop.ts#L518-L533
//   一两句说明（可选，显示在代码下面）
//   :::
// render(text) 由各站的构建器提供：把一段 Markdown（含摘录指令）渲染成 HTML。
export function renderTabs(lines, render) {
  const tabs = [];
  for (const line of lines) {
    const head = line.match(/^@@\s*(.+)$/);
    if (head) { tabs.push({ label: head[1].trim(), lines: [] }); continue; }
    if (tabs.length) tabs.at(-1).lines.push(line);
  }
  const bar = tabs.map((t, i) => `<button type="button" role="tab" data-label="${esc(t.label)}" aria-selected="${i === 0}">${esc(t.label)}</button>`).join("");
  const panes = tabs.map((t, i) => `<div class="code-tab${i === 0 ? " active" : ""}" role="tabpanel" data-label="${esc(t.label)}">${render(t.lines.join("\n"))}</div>`).join("");
  return `<div class="code-tabs"><div class="code-tabs-bar" role="tablist">${bar}</div>${panes}</div>`;
}
