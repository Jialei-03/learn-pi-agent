// 页面模板。所有页面共用同一套外壳：顶栏、课程目录、正文、本页目录。
import { PI, chapters, parts, type ChapterInfo, type PartInfo } from '../course/syllabus.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n: number) => String(n).padStart(2, '0');
const REPO = 'https://github.com/Jialei-03/learn-pi-agent';

export function moxMark(size = 28) {
  return `<svg class="mox-mark" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><circle cx="30" cy="6" r="4" fill="var(--signal)"/><path d="M30 10v6" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><rect x="8" y="16" width="44" height="42" rx="19" fill="var(--paper)" stroke="currentColor" stroke-width="3.5"/><ellipse cx="30" cy="35" rx="15" ry="10.5" fill="currentColor"/><ellipse cx="24.5" cy="35" rx="2.8" ry="4" fill="var(--paper)"/><ellipse cx="35.5" cy="35" rx="2.8" ry="4" fill="var(--paper)"/><rect x="49" y="30" width="11" height="13" rx="3.5" fill="currentColor"/><path d="M52.5 34l4 5M56.5 34l-4 5" stroke="var(--signal)" stroke-width="1.8" stroke-linecap="round"/></svg>`;
}

export interface PageMeta {
  chapter: ChapterInfo & { part: PartInfo };
  frontmatter: Record<string, string | string[]>;
  headings: { level: number; id: string; text: string }[];
}

function head(title: string, description: string, base: string) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="icon" href="${base}static/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${base}static/style.css">
<script>document.documentElement.dataset.theme = localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');</script>
</head>`;
}

function topbar(base: string) {
  return `<header class="topbar">
  <button class="icon-btn nav-toggle" type="button" aria-label="打开课程目录"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
  <a class="brand" href="${base}index.html">${moxMark(30)}<span class="brand-name">Learn Pi Agent</span></a>
  <div class="topbar-actions">
    <button class="search-btn" type="button" data-search-open><svg viewBox="0 0 24 24" width="16" height="16"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>搜索课程</span><kbd>⌘K</kbd></button>
    <a class="top-link" href="${base}interview.html">面试题库</a>
    <a class="top-link" href="${base}sources.html">源码索引</a>
    <button class="icon-btn theme-toggle" type="button" aria-label="切换深色模式"><svg class="sun" viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><svg class="moon" viewBox="0 0 24 24" width="18" height="18"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg></button>
    <a class="icon-btn" href="${REPO}" target="_blank" rel="noopener" aria-label="GitHub 仓库"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 3 .8.1-.6.4-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2z"/></svg></a>
  </div>
</header>`;
}

function sidebar(base: string, current?: string) {
  const groups = parts.map(part => `<div class="nav-part">
    <div class="nav-part-title">${esc(part.title)}</div>
    <ol>${part.chapters.map(c => {
      const ready = c.status === 'ready';
      const cls = [c.slug === current ? 'current' : '', ready ? '' : 'planned'].filter(Boolean).join(' ');
      const inner = `<span class="nav-num">${num(c.n)}</span><span class="nav-title">${esc(c.title.split('：')[0])}</span>`;
      return `<li class="${cls}">${ready ? `<a href="${base}chapters/${c.slug}.html"${c.slug === current ? ' aria-current="page"' : ''}>${inner}</a>` : `<span class="nav-disabled" title="编写中">${inner}</span>`}</li>`;
    }).join('')}</ol>
  </div>`).join('');
  return `<nav class="sidebar" aria-label="课程目录"><div class="sidebar-inner">${groups}
  <p class="nav-pin">源码基准 <a href="${PI.repo}/tree/${PI.commit}" target="_blank" rel="noopener">Pi ${PI.version}</a></p></div></nav>`;
}

function searchDialog() {
  return `<div class="search-dialog" hidden role="dialog" aria-label="搜索课程"><div class="search-panel">
  <input type="search" placeholder="搜索章节、概念、源码文件……" aria-label="搜索">
  <ol class="search-results"></ol>
  <p class="search-hint"><kbd>↑</kbd><kbd>↓</kbd> 选择 · <kbd>Enter</kbd> 打开 · <kbd>Esc</kbd> 关闭</p>
</div></div>`;
}

function shell(base: string, current: string | undefined, main: string, toc = '', wide = false) {
  return `<body${wide ? ' class="wide"' : ''}>
${topbar(base)}
<div class="shell${toc ? ' has-toc' : ''}">
${sidebar(base, current)}
<main id="main">${main}</main>
${toc}
</div>
${searchDialog()}
<div class="scrim" hidden></div>
<script type="module" src="${base}static/app.js"></script>
</body>
</html>`;
}

const asList = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

export function layout(meta: PageMeta, content: string) {
  const { chapter, frontmatter: fm, headings } = meta;
  const ready = chapters.filter(c => c.status === 'ready');
  const index = ready.findIndex(c => c.slug === chapter.slug);
  const prev = ready[index - 1];
  const next = ready[index + 1];
  const learn = asList(fm.learn);
  const metaLine = [
    fm.time ? `<span>约 ${esc(String(fm.time).replace(/^约\s*/, ''))}</span>` : '',
    fm.prereq ? `<span>前置：${esc(String(fm.prereq))}</span>` : '',
  ].filter(Boolean).join('');
  const toc = headings.length
    ? `<aside class="toc" aria-label="本页目录"><div class="toc-inner"><div class="toc-title">本页内容</div><ol>${headings.map(h => `<li class="lvl-${h.level}"><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ol></div></aside>`
    : '';
  const pager = `<nav class="pager">${prev ? `<a class="prev" href="${prev.slug}.html"><small>← 上一章</small><span>${esc(prev.title)}</span></a>` : '<span></span>'}${next ? `<a class="next" href="${next.slug}.html"><small>下一章 →</small><span>${esc(next.title)}</span></a>` : '<span></span>'}</nav>`;
  const main = `<article class="chapter">
<header class="chapter-head">
  <p class="eyebrow">第 ${num(chapter.n)} 章<span>·</span>${esc(chapter.part.title)}${chapter.extend ? '<span>·</span>扩展章节' : ''}</p>
  <h1>${esc(chapter.title)}</h1>
  <p class="lede">${esc(chapter.summary)}</p>
  ${fm.motto ? `<p class="motto">${esc(String(fm.motto))}</p>` : ''}
  ${learn.length ? `<div class="objectives"><p class="objectives-title">本章目标</p><ul>${learn.map(l => `<li>${esc(l)}</li>`).join('')}</ul>${fm.build ? `<p class="objectives-build"><span>动手产出</span>${esc(String(fm.build))}</p>` : ''}</div>` : ''}
  ${metaLine ? `<p class="chapter-meta">${metaLine}</p>` : ''}
</header>
<div class="prose">
${content}
</div>
${pager}
</article>`;
  return head(`${num(chapter.n)} ${chapter.title} · Learn Pi Agent`, chapter.summary, '../') + shell('../', chapter.slug, main, toc);
}

export function homePage() {
  const total = chapters.length;
  const done = chapters.filter(c => c.status === 'ready').length;
  const roadmap = parts.map(part => `<section class="road-part">
    <h3>${esc(part.title)}<small>${esc(part.subtitle)}</small></h3>
    <ol>${part.chapters.map(c => {
      const ready = c.status === 'ready';
      const body = `<span class="road-num">${num(c.n)}</span><span class="road-text"><strong>${esc(c.title)}</strong><span>${esc(c.summary)}</span></span>${c.extend ? '<span class="road-tag">扩展</span>' : ''}`;
      return `<li class="${ready ? 'ready' : 'planned'}">${ready ? `<a href="chapters/${c.slug}.html">${body}</a>` : `<div title="编写中">${body}</div>`}</li>`;
    }).join('')}</ol>
  </section>`).join('');

  const main = `<div class="home">
<section class="hero">
  <div class="hero-copy">
    <p class="eyebrow">Agent 工程课<span>·</span>基于 Pi ${PI.version}</p>
    <h1>从零造一个 Coding Agent<br><span class="hero-sub">再读懂一个生产级的</span></h1>
    <p class="hero-lead">先用几十行代码亲手实现一个机制，再故意让它坏掉，然后去 Pi 的源码里看生产级 Agent 是怎么修的。Pi 没有内置的能力，我们写扩展补上。</p>
    <div class="hero-actions">
      <a class="btn primary" href="chapters/00-course-map.html">开始学习</a>
      <a class="btn-link" href="chapters/01-from-api-to-agent.html">直接写第一个 Agent →</a>
    </div>
  </div>
  <figure class="hero-art"><img src="assets/mox-illustrations/mox-learning-path.png" alt="Mox 沿着模型、上下文、工具、循环、源码一路学习"></figure>
</section>

<section class="pillars">
  <article><span class="pillar-num">01</span><h3>亲手实现</h3><p>每章给 mox 加一个机制。零依赖 TypeScript，没有 API Key 也能离线运行。</p></article>
  <article><span class="pillar-num">02</span><h3>读生产源码</h3><p>源码摘录在构建时从 Pi 的固定提交读取，行号自动校验。</p></article>
  <article><span class="pillar-num">03</span><h3>写扩展补齐</h3><p>权限、Hooks、记忆、子 Agent——Pi 没有内置的，我们自己写。</p></article>
  <article><span class="pillar-num">04</span><h3>讲得出取舍</h3><p>每章附面试题和回答要点，汇总在<a href="interview.html">面试题库</a>。</p></article>
</section>

<section class="quickstart">
  <h2>五分钟跑起来</h2>
  <p>需要 Node.js 22.19 以上。没有 API Key 时自动使用脚本模型，离线、免费。</p>
  <pre><code>git clone ${REPO}.git
cd learn-pi-agent &amp;&amp; npm install
cd labs/fixtures/mox-project
node ../../../mox/stage-01/agent.ts "这个项目是做什么的？"</code></pre>
</section>

<section class="roadmap">
  <div class="roadmap-head"><h2>课程路线</h2><p>已完成 ${done} / ${total} 章 · 灰色章节正在编写 · 标“扩展”的是 Pi 未内置、由我们补齐的能力</p></div>
  ${roadmap}
</section>
</div>`;
  return head('Learn Pi Agent · 从零造一个 Coding Agent', '从零实现、读懂生产源码、补齐扩展能力的 Agent 工程课程。', '') + shell('', undefined, main, '', true);
}

export function interviewPage(items: { chapter: string; title: string; question: string; answer: string }[]) {
  const byChapter = new Map<string, typeof items>();
  for (const item of items) byChapter.set(item.chapter, [...(byChapter.get(item.chapter) ?? []), item]);
  const sections = [...byChapter.entries()].map(([slug, list]) => {
    const c = chapters.find(ch => ch.slug === slug)!;
    return `<section class="iv-group"><h2 id="${slug}"><span class="h-num">${num(c.n)}</span>${esc(c.title)}</h2>${list.map(i => `<details class="interview"><summary><span class="iv-q">${esc(i.question)}</span></summary><div class="iv-a">${i.answer}</div></details>`).join('')}<p class="iv-back"><a href="chapters/${slug}.html">回到第 ${c.n} 章 →</a></p></section>`;
  }).join('');
  const main = `<article class="chapter plain-page"><header class="chapter-head"><p class="eyebrow">汇总</p><h1>面试题库</h1><p class="lede">每章末尾的面试题都汇总在这里，共 ${items.length} 道。先自己回答，再展开对照要点。要点不是标准答案，而是“回答里应该出现的关键判断”。</p></header><div class="prose">${sections}</div></article>`;
  return head('面试题库 · Learn Pi Agent', 'Agent 工程面试题与回答要点', '') + shell('', undefined, main);
}

export function sourceIndexPage(citations: { chapter: string; title: string; file: string; start: number; end: number; url: string }[]) {
  const byFile = new Map<string, typeof citations>();
  for (const c of citations) byFile.set(c.file, [...(byFile.get(c.file) ?? []), c]);
  const rows = [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([file, list]) => {
    const pkg = file.split('/')[1];
    return `<tr><td><span class="pkg">${esc(pkg)}</span><code>${esc(file.split('/').slice(2).join('/'))}</code></td><td>${list.map(c => `<a href="${c.url}" target="_blank" rel="noopener">L${c.start}${c.end > c.start ? '–' + c.end : ''}</a>`).join(' ')}</td><td>${[...new Set(list.map(c => c.chapter))].map(slug => { const ch = chapters.find(x => x.slug === slug)!; return `<a href="chapters/${slug}.html">${num(ch.n)}</a>`; }).join(' ')}</td></tr>`;
  }).join('');
  const main = `<article class="chapter plain-page"><header class="chapter-head"><p class="eyebrow">汇总</p><h1>源码索引</h1><p class="lede">课程引用过的 Pi 源码，按文件排列。所有链接都指向固定提交 <a href="${PI.repo}/tree/${PI.commit}" target="_blank" rel="noopener">${PI.version} · ${PI.commit.slice(0, 7)}</a>，行号在每次构建时校验。</p></header><div class="prose"><div class="table-wrap"><table class="source-table"><thead><tr><th>文件</th><th>摘录位置</th><th>章节</th></tr></thead><tbody>${rows}</tbody></table></div></div></article>`;
  return head('源码索引 · Learn Pi Agent', 'Pi 源码索引', '') + shell('', undefined, main);
}
