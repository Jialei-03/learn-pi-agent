// 课程思维导图：由各章真实的源码摘录自动生成（三门课共用同一份实现）。
// 两种视图：按章节（课程 → 部分 → 章 → 源码文件）和按源码目录（目录 → 文件 → 在哪几章读过）。
// 同时导出 Obsidian Canvas 和 Markdown（含 mermaid mindmap），方便在笔记软件里继续整理。
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * @param {{ title: string, subtitle: string, chapters: { n: number, slug: string, title: string, part: string }[],
 *   citations: { chapter: string, file: string, start: number, end: number, url: string }[],
 *   display?: (file: string) => string, chapterHref?: (slug: string) => string }} input
 */
export function courseMap({ title, subtitle, chapters, citations, display = (f) => f, chapterHref = (slug) => `chapters/${slug}.html` }) {
  // 每章引用了哪些文件（同一文件的多段摘录合并成一条，记下行号）
  const byChapter = new Map(chapters.map((c) => [c.slug, new Map()]));
  for (const c of citations) {
    const files = byChapter.get(c.chapter);
    if (!files) continue;
    const row = files.get(c.file) ?? { file: c.file, ranges: [], url: c.url };
    if (!row.ranges.some((r) => r[0] === c.start && r[1] === c.end)) row.ranges.push([c.start, c.end]);
    files.set(c.file, row);
  }
  const parts = [...new Set(chapters.map((c) => c.part))];
  const lines = (ranges) => ranges.sort((a, b) => a[0] - b[0]).slice(0, 3).map(([a, b]) => (a === b ? `L${a}` : `L${a}–${b}`)).join(" ") + (ranges.length > 3 ? " …" : "");

  // ── 视图一：按章节 ──
  const chapterTree = `<ul class="mm-tree"><li><span class="mm-node mm-root">${esc(title)}</span><ul>${parts
    .map((part) => `<li><span class="mm-node mm-part">${esc(part)}</span><ul>${chapters
      .filter((c) => c.part === part)
      .map((c) => {
        const files = [...byChapter.get(c.slug).values()];
        return `<li><a class="mm-node mm-chapter" href="${chapterHref(c.slug)}"><b>${String(c.n).padStart(2, "0")}</b> ${esc(c.title)}</a>${files.length ? `<ul>${files.map((f) => `<li><a class="mm-node mm-file" href="${esc(f.url)}" target="_blank" rel="noopener"><code>${esc(display(f.file))}</code><small>${lines(f.ranges)}</small></a></li>`).join("")}</ul>` : ""}</li>`;
      })
      .join("")}</ul></li>`)
    .join("")}</ul></li></ul>`;

  // ── 视图二：按源码目录 ──
  const byFile = new Map();
  for (const [slug, files] of byChapter) for (const f of files.values()) {
    const row = byFile.get(f.file) ?? { file: f.file, url: f.url.replace(/#.*$/, ""), chapters: new Set() };
    row.chapters.add(slug);
    byFile.set(f.file, row);
  }
  const dirOf = (file) => { const parts = display(file).split("/"); return parts.length > 2 ? parts.slice(0, 2).join("/") + "/" : parts.length === 2 ? parts[0] + "/" : "（根目录）"; };
  const dirs = new Map();
  for (const row of byFile.values()) dirs.set(dirOf(row.file), [...(dirs.get(dirOf(row.file)) ?? []), row]);
  const chapterNo = new Map(chapters.map((c) => [c.slug, c]));
  const dirTree = `<ul class="mm-tree"><li><span class="mm-node mm-root">${esc(title)}</span><ul>${[...dirs.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([dir, rows]) => `<li><span class="mm-node mm-part"><code>${esc(dir)}</code><small>${rows.length} 个文件</small></span><ul>${rows
      .sort((a, b) => a.file.localeCompare(b.file))
      .map((r) => `<li><a class="mm-node mm-file" href="${esc(r.url)}" target="_blank" rel="noopener"><code>${esc(display(r.file).slice(dir === "（根目录）" ? 0 : dir.length))}</code></a><span class="mm-tags">${[...r.chapters].map((s) => `<a href="${chapterHref(s)}" title="${esc(chapterNo.get(s).title)}">${String(chapterNo.get(s).n).padStart(2, "0")}</a>`).join("")}</span></li>`)
      .join("")}</ul></li>`)
    .join("")}</ul></li></ul>`;

  const stats = `${chapters.length} 章 · ${byFile.size} 个源码文件 · ${citations.length} 处摘录`;
  const html = `<p class="lede">${esc(subtitle)}</p>
<p class="mm-stats">${stats}。由各章正文里的源码摘录自动生成，点章节进入正文，点文件打开固定版本的源码。也可以下载 <a href="engineering/architecture.canvas" download>Obsidian Canvas</a> 或 <a href="engineering/engineering-map.md" download>Markdown 思维导图</a> 继续整理。</p>
<div class="mm-tabs" role="tablist"><button role="tab" aria-selected="true" data-view="chapters">按章节</button><button role="tab" aria-selected="false" data-view="dirs">按源码目录</button></div>
<div class="mm-view" data-view="chapters">${chapterTree}</div>
<div class="mm-view" data-view="dirs" hidden>${dirTree}</div>
<script>
document.querySelectorAll('.mm-tabs button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.mm-tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
  document.querySelectorAll('.mm-view').forEach(v => { v.hidden = v.dataset.view !== b.dataset.view; });
}));
document.querySelectorAll('.mm-tree .mm-part, .mm-tree .mm-chapter').forEach(node => {
  const li = node.parentElement;
  if (!li.querySelector(':scope > ul')) return;
  node.classList.add('mm-toggle');
  node.addEventListener('click', e => { if (node.tagName === 'A' && !e.altKey) return; e.preventDefault(); li.classList.toggle('mm-collapsed'); });
});
</script>`;

  // ── Obsidian Canvas：四列布局 ──
  const canvas = { nodes: [], edges: [] };
  const id = (s) => [...s].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7).toString(16).padStart(8, "0") + s.length.toString(16);
  let y = 0;
  const rootId = id("root" + title);
  for (const part of parts) {
    const partY = y;
    const partId = id("part" + part);
    for (const c of chapters.filter((c) => c.part === part)) {
      const chapterId = id("ch" + c.slug);
      const files = [...byChapter.get(c.slug).values()];
      const chY = y;
      for (const f of files) {
        const fileId = id(c.slug + f.file);
        canvas.nodes.push({ id: fileId, type: "text", x: 1100, y, width: 520, height: 70, text: `[${display(f.file)}](${f.url}) ${lines(f.ranges)}` });
        canvas.edges.push({ id: id("e" + chapterId + fileId), fromNode: chapterId, fromSide: "right", toNode: fileId, toSide: "left" });
        y += 90;
      }
      if (!files.length) y += 90;
      canvas.nodes.push({ id: chapterId, type: "text", x: 620, y: Math.round((chY + y - 90) / 2), width: 400, height: 70, color: "4", text: `**${String(c.n).padStart(2, "0")}** ${c.title}` });
      canvas.edges.push({ id: id("e" + partId + chapterId), fromNode: partId, fromSide: "right", toNode: chapterId, toSide: "left" });
      y += 30;
    }
    canvas.nodes.push({ id: partId, type: "text", x: 300, y: Math.round((partY + y - 120) / 2), width: 240, height: 60, color: "2", text: `## ${part}` });
    canvas.edges.push({ id: id("e" + rootId + partId), fromNode: rootId, fromSide: "right", toNode: partId, toSide: "left" });
    y += 60;
  }
  canvas.nodes.unshift({ id: rootId, type: "text", x: 0, y: Math.round(y / 2 - 60), width: 240, height: 120, color: "5", text: `# ${title}\n\n${stats}` });

  // ── Markdown（mermaid mindmap + 文件清单） ──
  const clean = (s) => s.replace(/[()[\]{}]/g, " ");
  const mermaid = ["mindmap", `  root((${clean(title)}))`, ...parts.flatMap((p) => [`    ${clean(p)}`, ...chapters.filter((c) => c.part === p).flatMap((c) => [`      ${String(c.n).padStart(2, "0")} ${clean(c.title.split("：")[0])}`, ...[...byChapter.get(c.slug).values()].map((f) => `        ${display(f.file).split("/").pop()}`)])])].join("\n");
  const markdown = `# ${title}\n\n${subtitle}\n\n${stats}\n\n\`\`\`mermaid\n${mermaid}\n\`\`\`\n\n` + chapters.map((c) => `## ${String(c.n).padStart(2, "0")} ${c.title}\n\n` + [...byChapter.get(c.slug).values()].map((f) => `- [${display(f.file)}](${f.url}) ${lines(f.ranges)}`).join("\n")).join("\n\n") + "\n";

  return { html, canvas: JSON.stringify(canvas, null, 2) + "\n", markdown, stats };
}

/** 思维导图页面的样式（三门课的 style.css 都包含它）。 */
export const COURSE_MAP_CSS = `
.mm-stats { color: var(--muted); font-size: 14px; }
.mm-tabs { display: flex; gap: 8px; margin: 18px 0 8px; }
.mm-tabs button { font: inherit; font-size: 14px; padding: 6px 14px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--ink-2); cursor: pointer; }
.mm-tabs button[aria-selected="true"] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.mm-view { overflow-x: auto; padding: 12px 0 24px; }
.mm-view .mm-tree, .mm-view .mm-tree ul { list-style: none; margin: 0; padding: 0; }
.mm-view .mm-tree ul { padding-left: 28px; position: relative; }
.mm-view .mm-tree li { position: relative; margin: 0; padding: 4px 0 4px 18px; }
.mm-tree li::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; border-left: 1.5px solid var(--line-2); }
.mm-tree li::after { content: ""; position: absolute; left: 0; top: 19px; width: 14px; border-top: 1.5px solid var(--line-2); }
.mm-tree li:last-child::before { bottom: auto; height: 19px; }
.mm-view .mm-tree > li { padding-left: 0; }
.mm-tree > li::before, .mm-tree > li::after { display: none; }
.mm-node { display: inline-flex; align-items: baseline; gap: 8px; padding: 5px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); font-size: 14px; line-height: 1.5; text-decoration: none; max-width: 100%; }
a.mm-node:hover { border-color: var(--accent); }
.mm-root { background: var(--ink); color: var(--bg); border-color: var(--ink); font-weight: 700; font-size: 15px; }
.mm-part { background: var(--accent-soft); border-color: transparent; font-weight: 600; }
.mm-chapter b { color: var(--accent-ink); font-variant-numeric: tabular-nums; }
.mm-file { background: var(--bg-soft); }
.mm-file code, .mm-part code { font-size: 12.5px; background: none; padding: 0; }
.mm-node small { color: var(--muted); font-size: 12px; font-family: var(--mono); }
.mm-toggle { cursor: pointer; }
.mm-collapsed > ul { display: none; }
.mm-collapsed > .mm-toggle::after { content: " ＋"; color: var(--muted); }
.mm-tags { margin-left: 8px; display: inline-flex; gap: 4px; }
.mm-tags a { font: 600 11px/1 var(--sans); padding: 3px 6px; border-radius: 4px; background: var(--accent-soft); color: var(--accent-ink); text-decoration: none; }
`;
