// 课程网站生成器。
//   node site/build.ts            生成 site/dist
//   node site/build.ts --check    只检查（源码摘录、实验、链接），不写文件
//   node site/build.ts --only 05-coding-tools,06-context-assembly   只构建 / 检查这几章（写文件时只更新这些章节的页面）
//
// 正文是 course/*.md。除了普通 Markdown，还支持几种指令：
//   @pi packages/agent/src/agent-loop.ts#L172-L190   摘录 Pi 源码（固定版本，构建时校验）；#符号名、#region:名字 也可以
//   @pi packages/agent/src/agent-loop.ts#runLoop      按名字摘录一个函数 / 类型
//   @code mox/src/loop.ts#runLoop                     摘录本仓库的代码；mox/ 是 Mox-agent 仓库的子模块，链接指向它的固定提交
//   @lab node labs/ch03/compare.ts truncated | md     构建时真正运行实验，把输出嵌进页面
//   @trace node labs/ch01/trace.ts                    运行并生成可交互的消息回放
//   @figure assets/xxx.png 说明文字                    插图；@figure pending 说明文字 显示待补插画
//   ::: predict / ??? / :::                           先预测再揭晓
//   ::: interview 问题 / :::                           面试题（汇总到面试题库页面）
//   ::: note|warn|insight|compare|build 标题 / :::    提示框
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import { createHighlighter } from 'shiki';
import { PI, chapters, parts } from '../course/syllabus.ts';
import { layout, homePage, interviewPage, mapPage, moxMark, setSections, sourceIndexPage, type PageMeta } from './templates.ts';
import { numberChapter, parseSteps, renderSteps, renderTabs } from './book.mjs';

import { courseMap } from '../scripts/course-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'site/dist');
const PI_SRC = process.env.PI_SRC ?? join(ROOT, '../pi-v1.5.0');
const CHECK_ONLY = process.argv.includes('--check');
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1]?.split(',') : undefined;
const selected = chapters.filter(c => c.status === 'ready' && (!ONLY || ONLY.includes(c.slug)));
if (ONLY && selected.length !== ONLY.length) throw new Error(`--only 里有不存在的章节：${ONLY.join(', ')}`);
const errors: string[] = [];

// ── Pi 源码版本校验：摘录必须来自固定的提交 ──────────────────────────
const piHead = execFileSync('git', ['-C', PI_SRC, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
// mox 是子模块：课程固定在子模块记录的那个提交上
const MOX_COMMIT = execFileSync('git', ['-C', ROOT, 'ls-tree', 'HEAD', 'mox'], { encoding: 'utf8' }).split(/\s+/)[2] ?? '';
const moxHead = execFileSync('git', ['-C', join(ROOT, 'mox'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (MOX_COMMIT && moxHead !== MOX_COMMIT) console.warn(`提示：mox 子模块位于 ${moxHead.slice(0, 7)}，课程记录的是 ${MOX_COMMIT.slice(0, 7)}（git submodule update 可以对齐）`);
if (piHead !== PI.commit) throw new Error(`PI_SRC (${PI_SRC}) 位于 ${piHead}，课程固定在 ${PI.version} = ${PI.commit}`);

const highlighter = await createHighlighter({
  themes: ['github-light', 'github-dark-dimmed'],
  langs: ['ts', 'js', 'json', 'bash', 'diff', 'markdown', 'yaml', 'text', 'jsonl'],
});
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function highlight(code: string, lang: string, options: { start?: number; hl?: Set<number> } = {}) {
  const language = highlighter.getLoadedLanguages().includes(lang) ? lang : 'text';
  return highlighter.codeToHtml(code, {
    lang: language,
    themes: { light: 'github-light', dark: 'github-dark-dimmed' },
    defaultColor: false,
    transformers: [{
      pre(node) { node.properties.style = `--start:${(options.start ?? 1) - 1}`; },
      line(node, line) { if (options.hl?.has(line + (options.start ?? 1) - 1)) this.addClassToHast(node, 'hl'); },
    }],
  });
}

const langOf = (path: string) => ({ ts: 'ts', tsx: 'ts', js: 'js', mjs: 'js', json: 'json', md: 'markdown', sh: 'bash', yaml: 'yaml', jsonl: 'jsonl' })[path.split('.').pop() ?? ''] ?? 'text';

// ── 源码摘录 ───────────────────────────────────────────────────────
interface Excerpt { file: string; start: number; end: number; code: string }

/** 按名字找一个声明的范围：从声明行到同一缩进的闭合行。 */
function findSymbol(lines: string[], name: string): [number, number] | undefined {
  const decl = new RegExp(`^(\\s*)(export\\s+)?(default\\s+)?(async\\s+)?(function\\*?|const|let|class|interface|type|enum)\\s+${name}\\b`);
  const method = new RegExp(`^(\\s*)(public |private |protected |static |async )*${name}\\s*[(<]`);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(decl) ?? lines[i].match(method);
    if (!m) continue;
    const indent = m[1];
    const opens = (lines[i].match(/[{(]/g) ?? []).length;
    const closes = (lines[i].match(/[})]/g) ?? []).length;
    if ((/;\s*$/.test(lines[i]) && opens === 0) || (opens > 0 && opens === closes)) return [i + 1, i + 1];
    for (let j = i + 1; j < lines.length; j++) {
      // 只有“单独一个闭合括号”的行才算结束：跳过 `}): Foo {` 这种多行参数类型的收尾
      const closes = /^[}\])][;,)]*\s*$/.test(lines[j].slice(indent.length)) && lines[j].length - lines[j].trimStart().length === indent.length;
      if (closes) return [i + 1, j + 1];
    }
  }
  return undefined;
}

function excerpt(base: string, spec: string, where: string): Excerpt | undefined {
  const [file, anchor = ''] = spec.split('#');
  const path = join(base, file);
  if (!existsSync(path)) { errors.push(`${where}: 找不到文件 ${file}`); return; }
  const lines = readFileSync(path, 'utf8').split('\n');
  let range: [number, number] | undefined;
  const lineMatch = anchor.match(/^L(\d+)(?:-L(\d+))?$/);
  // region:名字 —— 源码里用 `// #region 名字` 和 `// #endregion` 标出的一段（会随代码移动，不怕行号变化）
  const region = anchor.match(/^region:(.+)$/);
  if (lineMatch) range = [Number(lineMatch[1]), Number(lineMatch[2] ?? lineMatch[1])];
  else if (region) {
    const s = lines.findIndex(l => l.trim() === `// #region ${region[1]}`);
    const e = lines.findIndex((l, i) => i > s && /^\s*\/\/ #endregion/.test(l));
    if (s >= 0 && e > s) range = [s + 2, e];
  }
  else if (anchor && !region) range = findSymbol(lines, anchor);
  else range = [1, lines.length];
  if (!range) { errors.push(`${where}: 在 ${file} 里找不到 ${anchor}`); return; }
  if (range[1] > lines.length) { errors.push(`${where}: ${file} 只有 ${lines.length} 行，摘录到了 ${range[1]}`); return; }
  return { file, start: range[0], end: range[1], code: lines.slice(range[0] - 1, range[1]).join('\n') };
}

/** 摘录的同时记录下来，生成“源码索引”页面。 */
const citations: { chapter: string; title: string; file: string; start: number; end: number; url: string }[] = [];

function renderExcerpt(kind: 'pi' | 'code', args: string, where: { slug: string; title: string }) {
  const [spec, ...rest] = args.trim().split(/\s+/);
  const opts = Object.fromEntries(rest.map(o => o.split('=')).map(([k, v]) => [k, v ?? 'true']));
  const ex = excerpt(kind === 'pi' ? PI_SRC : ROOT, spec, where.slug);
  if (!ex) return '';
  const hl = new Set<number>();
  for (const part of (opts.hl ?? '').split(',').filter(Boolean)) {
    const [a, b] = part.split('-').map(Number);
    for (let i = a; i <= (b ?? a); i++) hl.add(i);
  }
  // 高亮行必须落在摘录范围里：代码改动后行号漂移，这里会第一时间报出来
  const outside = [...hl].filter(l => l < ex.start || l > ex.end);
  if (outside.length) errors.push(`${where.slug}: ${ex.file} 的高亮行 ${outside.join(',')} 不在摘录范围 ${ex.start}–${ex.end} 里`);
  const lineCount = ex.end - ex.start + 1;
  const url = kind === 'pi'
    ? `${PI.repo}/blob/${PI.commit}/${ex.file}#L${ex.start}-L${ex.end}`
    : ex.file.startsWith('mox/')
      ? `https://github.com/Jialei-03/Mox-agent/blob/${moxHead}/${ex.file.slice(4)}#L${ex.start}-L${ex.end}`
      : `https://github.com/Jialei-03/learn-pi-agent/blob/main/${ex.file}#L${ex.start}-L${ex.end}`;
  if (kind === 'pi') citations.push({ chapter: where.slug, title: where.title, file: ex.file, start: ex.start, end: ex.end, url });
  const badge = kind === 'pi' ? `<span class="src-badge pi">Pi ${PI.version}</span>` : '<span class="src-badge mox">mox</span>';
  const label = opts.title ? `<span class="src-title">${esc(decodeURIComponent(opts.title))}</span>` : '';
  const collapsed = opts.collapse === 'true' || (opts.collapse !== 'false' && lineCount > 60);
  return `<figure class="src ${kind}${collapsed ? ' collapsible collapsed' : ''}">
<figcaption>${badge}<a class="src-path" href="${url}" target="_blank" rel="noopener">${esc(ex.file)}<span class="src-lines">:${ex.start}${ex.end > ex.start ? '–' + ex.end : ''}</span></a>${label}<button class="copy" type="button" aria-label="复制代码">复制</button></figcaption>
${highlight(ex.code, langOf(ex.file), { start: ex.start, hl })}
${collapsed ? `<button class="expand" type="button">展开全部 ${lineCount} 行</button>` : ''}
</figure>`;
}

// ── 构建时运行实验 ────────────────────────────────────────────────
function runLab(command: string, where: string, mergeStderr = true) {
  try {
    // 用 shell 运行，允许 `cd 目录 && 命令`；stderr 合并进输出，和读者在终端里看到的一致
    return execFileSync('sh', ['-c', mergeStderr ? `${command} 2>&1` : command], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, MOX_API_KEY: '', FORCE_COLOR: '0' }, timeout: 60_000 });
  } catch (error: any) {
    // stderr 已经合并进 stdout：失败时把输出的最后几行带上，CI 日志里才看得到原因
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim() || error.message;
    errors.push(`${where}: 实验失败 \`${command}\`\n${output.split('\n').slice(-15).map((l: string) => `      ${l}`).join('\n')}`);
    return '';
  }
}

/**
 * 实验的纯文本输出里，可能夹着 Markdown 表格（以 | 开头、带 | --- | 分隔行的连续几行）。
 * 表格渲染成真正的表格，其余部分保持等宽文本。
 */
function renderMixedOutput(output: string): string {
  const lines = output.split('\n');
  const parts: string[] = [];
  let text: string[] = [];
  const flush = () => { if (text.join('').trim()) parts.push(`<pre class="lab-out">${esc(text.join('\n').replace(/^\n+|\n+$/g, ''))}</pre>`); text = []; };
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('|') && /^\|\s*-{3}/.test(lines[i + 1] ?? '')) {
      flush();
      const table: string[] = [];
      while (i < lines.length && lines[i].startsWith('|')) table.push(lines[i++]);
      i--;
      parts.push(`<div class="lab-md">${md.render(table.join('\n'))}</div>`);
    } else text.push(lines[i]);
  }
  flush();
  return parts.join('\n');
}

function renderLab(args: string, where: string) {
  const [command, mode = ''] = args.split('|').map(s => s.trim());
  const output = runLab(command, where).trimEnd();
  const body = mode === 'md'
    ? `<div class="lab-md">${md.render(output)}</div>`
    : renderMixedOutput(output);
  return `<figure class="lab">
<figcaption><code class="lab-cmd"><span>$</span> ${esc(command)}</code><span class="lab-label">实际运行输出</span><button class="copy" type="button" data-copy="${esc(command)}">复制命令</button></figcaption>
${body}
</figure>`;
}

/** 原样展示一个文本文件（比如录制下来的真实运行记录），不加行号。 */
function renderInclude(file: string, where: string) {
  const path = join(ROOT, file);
  if (!existsSync(path)) { errors.push(`${where}: 找不到 ${file}`); return ''; }
  const content = readFileSync(path, 'utf8').trimEnd();
  // 录制的文本记录里如果有表格（比如评测报告），用和实验输出一样的方式渲染
  const body = file.endsWith('.txt') && /^\|.*\n\|\s*-{3}/m.test(content) ? `<div class="recorded-mixed">${renderMixedOutput(content)}</div>` : highlight(content, langOf(file));
  return `<figure class="src plain recorded"><figcaption><span class="src-lang">${esc(file)}</span><button class="copy" type="button" aria-label="复制">复制</button></figcaption>${body}</figure>`;
}

function renderTrace(args: string, where: string) {
  const json = runLab(args.trim(), where, false);
  if (!json) return '';
  try { JSON.parse(json); } catch { errors.push(`${where}: ${args} 的输出不是 JSON`); return ''; }
  return `<div class="trace-player" data-source="${esc(args.trim())}"><script type="application/json">${json.replace(/</g, '\\u003c')}</script><noscript>交互回放需要 JavaScript。</noscript></div>`;
}

function renderFigure(args: string, where: string) {
  const [src, ...captionParts] = args.trim().split(/\s+/);
  const caption = captionParts.join(' ');
  if (src === 'pending') {
    return `<figure class="figure pending"><div class="pending-art" aria-hidden="true">${moxMark(64)}</div><figcaption><strong>插画待生成</strong>${esc(caption)}</figcaption></figure>`;
  }
  if (!existsSync(join(ROOT, src))) {
    // 插画还没生成：显示占位卡片，图片文件一出现就会自动替换（需求见 assets/course/BRIEFS.md）
    console.warn(`  待生成插画：${src}（${where}）`);
    return `<figure class="figure pending"><div class="pending-art" aria-hidden="true">${moxMark(64)}</div><figcaption><strong>插画待生成 · ${esc(src.split('/').pop()!)}</strong>${esc(caption)}</figcaption></figure>`;
  }
  usedAssets.add(src);
  // 有 cwebp 时额外生成一份 WebP（体积约为 PNG 的十分之一），浏览器支持就用它；PNG 仍然是点开大图时的原图
  const webp = HAS_CWEBP && src.endsWith('.png') ? `<source srcset="../${src.replace(/\.png$/, '.webp')}" type="image/webp">` : '';
  return `<figure class="figure"><a href="../${src}" target="_blank" rel="noopener"><picture>${webp}<img src="../${src}" alt="${esc(caption)}" loading="lazy"></picture></a>${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}</figure>`;
}
const HAS_CWEBP = (() => { try { execFileSync('cwebp', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const usedAssets = new Set<string>(['assets/mox-illustrations/mox-learning-path.png']);


// ── 分步动画图：@steps 命令输出 { title, frames: [{ note, mermaid }] } ──────
function renderStepsCommand(args: string, where: string) {
  const json = runLab(args.trim(), where, false);
  if (!json) return '';
  try { const data = JSON.parse(json); return renderSteps(data.title ?? '', data.frames); }
  catch { errors.push(`${where}: ${args} 的输出不是分步图 JSON`); return ''; }
}

// ── Markdown ───────────────────────────────────────────────────────
const md: MarkdownIt = new MarkdownIt({
  html: true,
  linkify: false,
  typographer: false,
  highlight: (code, lang) => highlight(code.replace(/\n$/, ''), lang || 'text'),
});
// 外部链接新窗口打开；标题加锚点
md.renderer.rules.link_open = (tokens, i, options, _env, self) => {
  const href = tokens[i].attrGet('href') ?? '';
  if (/^https?:/.test(href)) { tokens[i].attrSet('target', '_blank'); tokens[i].attrSet('rel', 'noopener'); }
  return self.renderToken(tokens, i, options);
};
md.renderer.rules.fence = (tokens, i) => {
  const token = tokens[i];
  const lang = token.info.trim().split(/\s+/)[0] || 'text';
  if (lang === 'mermaid') return `<figure class="diagram lesson-diagram"><pre class="mermaid">${esc(token.content)}</pre><figcaption>示意图 · 点击放大</figcaption></figure>`;
  return `<figure class="src plain"><figcaption><span class="src-lang">${esc(lang === 'text' ? '' : lang)}</span><button class="copy" type="button" aria-label="复制代码">复制</button></figcaption>${highlight(token.content.replace(/\n$/, ''), lang)}</figure>`;
};
md.renderer.rules.table_open = () => '<div class="table-wrap"><table>';
md.renderer.rules.table_close = () => '</table></div>';

export const slugify = (text: string) =>
  text.toLowerCase().replace(/<[^>]+>/g, '').replace(/[`*_~“”"'：:，,。.？?！!（）()、/\\[\]{}|<>@#$%^&+=]/g, '').trim().replace(/\s+/g, '-') || 'section';

interface Heading { level: number; id: string; text: string; num?: string }

function renderMarkdown(source: string, headings: Heading[]) {
  const env: Record<string, unknown> = {};
  const tokens = md.parse(source, env);
  const seen = new Map<string, number>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'heading_open' || !['h2', 'h3'].includes(t.tag)) continue;
    const text = tokens[i + 1].content;
    let id = slugify(text);
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    if (n) id += `-${n}`;
    t.attrSet('id', id);
    headings.push({ level: Number(t.tag[1]), id, text: text.replace(/`/g, '') });
  }
  return md.renderer.render(tokens, md.options, env);
}

// ── 指令预处理：在交给 Markdown 之前，把指令替换成 HTML ─────────────
const CALLOUT_LABEL: Record<string, string> = { note: '说明', warn: '注意', insight: '关键洞察', compare: 'Claude Code 对照', build: '动手', pi: 'Pi 怎么做' };
const interviews: { chapter: string; title: string; question: string; answer: string }[] = [];

function preprocess(source: string, where: { slug: string; title: string }) {
  const lines = source.split('\n');
  const out: string[] = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^(```|~~~)/.test(line)) fence = !fence;
    if (fence) { out.push(line); continue; }

    // 手写的 SVG 图示：去掉内部空行和缩进，否则 Markdown 会在空行处截断 HTML 块
    if (line.startsWith('<figure class="diagram"')) {
      const block: string[] = [];
      let j = i;
      for (; j < lines.length; j++) {
        if (lines[j].trim()) block.push(lines[j].trim());
        if (lines[j].includes('</figure>')) break;
      }
      i = j;
      out.push('', block.join('\n'), '');
      continue;
    }

    const directive = line.match(/^@(pi|code|lab|trace|steps|figure|include)\s+(.+)$/);
    if (directive) {
      const [, kind, args] = directive;
      const html = kind === 'include' ? renderInclude(args.trim(), where.slug)
        : kind === 'pi' || kind === 'code' ? renderExcerpt(kind, args, where)
        : kind === 'lab' ? renderLab(args, where.slug)
        : kind === 'trace' ? renderTrace(args, where.slug)
        : kind === 'steps' ? renderStepsCommand(args, where.slug)
        : renderFigure(args, where.slug);
      out.push('', html.replace(/\n\s*\n/g, '\n'), '');
      continue;
    }

    const container = line.match(/^:::\s*(\w+)\s*(.*)$/);
    if (container) {
      const [, type, title] = container;
      const body: string[] = [];
      let j = i + 1;
      for (; j < lines.length && !/^:::\s*$/.test(lines[j]); j++) body.push(lines[j]);
      if (j >= lines.length) errors.push(`${where.slug}: 第 ${i + 1} 行的 ::: ${type} 没有闭合`);
      i = j;
      const inner = (text: string) => renderMarkdown(preprocess(text, where), []);
      let html: string;
      if (type === 'steps') {
        html = renderSteps(title, parseSteps(body.join('\n')));
      } else if (type === 'tabs') {
        html = renderTabs(body, text => inner(text));
      } else if (type === 'predict') {
        const split = body.findIndex(l => /^\?\?\?\s*$/.test(l));
        const question = inner(body.slice(0, split < 0 ? body.length : split).join('\n'));
        const answer = split < 0 ? '' : inner(body.slice(split + 1).join('\n'));
        html = `<aside class="predict"><p class="predict-head">想一想${title ? `<span>${esc(title)}</span>` : ''}</p><div class="predict-q">${question}</div><details><summary>显示答案</summary><div class="predict-a">${answer}</div></details></aside>`;
      } else if (type === 'interview') {
        const answer = inner(body.join('\n'));
        interviews.push({ chapter: where.slug, title: where.title, question: title, answer });
        html = `<details class="interview"><summary><span class="iv-q">${esc(title)}</span></summary><div class="iv-a">${answer}</div></details>`;
      } else {
        const label = CALLOUT_LABEL[type] ?? type;
        html = `<aside class="callout ${type}"><div class="callout-head"><span class="callout-label">${label}</span>${title ? `<span class="callout-title">${esc(title)}</span>` : ''}</div>${inner(body.join('\n'))}</aside>`;
      }
      out.push('', html.replace(/\n\s*\n/g, '\n'), '');
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

// ── 页面 ───────────────────────────────────────────────────────────
function parseFrontmatter(text: string) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  const data: Record<string, string | string[]> = {};
  if (!match) return { data, body: text };
  let key = '';
  for (const line of match[1].split('\n')) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && key) { (data[key] as string[]).push(item[1]); continue; }
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) { key = kv[1]; data[key] = kv[2] ? kv[2] : []; }
  }
  return { data, body: text.slice(match[0].length) };
}

const pages: { file: string; html: string }[] = [];
const searchIndex: { url: string; chapter: string; title: string; section?: string; text: string }[] = [];
/** 按小节建搜索索引：每个 h2/h3 一条，正文全文可搜（以前只索引每章前 6000 字）。 */
function sectionIndex(html: string, url: string, chapter: string, title: string) {
  const plain = (s: string) => s.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const parts = html.split(/(?=<h[23][^>]*\bid=")/);
  const rows: { url: string; chapter: string; title: string; section?: string; text: string }[] = [];
  for (const part of parts) {
    const head = part.match(/^<h[23][^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h[23]>/);
    const text = plain(head ? part.slice(head[0].length) : part).slice(0, 8000);
    rows.push(head ? { url: `${url}#${head[1]}`, chapter, title, section: plain(head[2]), text } : { url, chapter, title, text });
  }
  return rows;
}


const rendered: { chapter: typeof chapters[number]; data: Record<string, string | string[]>; linked: string; headings: Heading[] }[] = [];
for (const chapter of selected) {
  const path = join(ROOT, 'course', `${chapter.slug}.md`);
  if (!existsSync(path)) {
    if (process.env.DRAFT) { console.warn(`（草稿模式）跳过缺少的正文 ${chapter.slug}`); continue; }
    errors.push(`缺少正文：course/${chapter.slug}.md`);
    continue;
  }
  const { data, body } = parseFrontmatter(readFileSync(path, 'utf8'));
  const where = { slug: chapter.slug, title: chapter.title };
  const raw: Heading[] = [];
  const html = renderMarkdown(preprocess(body, where), raw);
  // 站内链接：course/xx.md → xx.html；再给标题和图加上编号（3.1、图 3-1）
  const numbered = numberChapter(html.replace(/href="(?:\.\/)?([0-9]{2}-[a-z0-9-]+)\.md(#[^"]*)?"/g, 'href="$1.html$2"'), chapter.n, raw);
  rendered.push({ chapter, data, linked: numbered.html, headings: numbered.headings });
  searchIndex.push(...sectionIndex(numbered.html, `chapters/${chapter.slug}.html`, `${String(chapter.n).padStart(2, '0')}`, chapter.title));
}
// 先渲染完所有章节，左侧目录才能列出每一章的小节
setSections(new Map(rendered.map(r => [r.chapter.slug, r.headings])));
for (const r of rendered) {
  const meta: PageMeta = { chapter: r.chapter, frontmatter: r.data, headings: r.headings };
  pages.push({ file: `chapters/${r.chapter.slug}.html`, html: layout(meta, r.linked) });
}

// 检查正文里直接写的 Pi 源码链接：文件必须存在，行号不能越界
for (const chapter of selected) {
  const path = join(ROOT, 'course', `${chapter.slug}.md`);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, 'utf8');
  for (const [, commit, file, line] of text.matchAll(/https:\/\/github\.com\/earendil-works\/pi\/blob\/([0-9a-f]+)\/([^#)\s]+)(?:#L(\d+))?/g)) {
    if (commit !== PI.commit) { errors.push(`${chapter.slug}: 链接使用了非固定提交 ${commit.slice(0, 7)}`); continue; }
    const target = join(PI_SRC, file);
    if (!existsSync(target)) { errors.push(`${chapter.slug}: 链接指向不存在的文件 ${file}`); continue; }
    if (line && Number(line) > readFileSync(target, 'utf8').split('\n').length) errors.push(`${chapter.slug}: ${file}#L${line} 超出文件长度`);
  }
}

// 检查站内链接
for (const page of pages) {
  for (const [, target] of page.html.matchAll(/href="([0-9]{2}-[a-z0-9-]+)\.html/g)) {
    const c = chapters.find(ch => ch.slug === target);
    if (!c) errors.push(`${page.file}: 链接到不存在的章节 ${target}`);
  }
}

const MAP = courseMap({
  title: `Pi ${PI.version}`,
  subtitle: '这门课读过的每一段 Pi 源码：按章节看学习路线，按目录看覆盖了源码的哪些部分。',
  chapters: chapters.filter(c => c.status === 'ready').map(c => ({ n: c.n, slug: c.slug, title: c.title, part: c.part.title })),
  citations,
  display: (file: string) => file.replace(/^packages\//, ''),
});
if (!ONLY) {
  pages.push({ file: 'map.html', html: mapPage(MAP.html) });
  pages.push({ file: 'index.html', html: homePage() });
  pages.push({ file: 'interview.html', html: interviewPage(interviews) });
  pages.push({ file: 'sources.html', html: sourceIndexPage(citations) });
}

if (errors.length) {
  console.error(`构建失败，${errors.length} 个问题：\n` + errors.map(e => '  · ' + e).join('\n'));
  process.exit(1);
}
if (CHECK_ONLY) {
  console.log(`检查通过：${pages.length} 个页面，${citations.length} 处 Pi 源码摘录，${interviews.length} 道面试题`);
  process.exit(0);
}

if (!ONLY) rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'chapters'), { recursive: true });
for (const page of pages) writeFileSync(join(OUT, page.file), page.html);
cpSync(join(ROOT, 'site/static'), join(OUT, 'static'), { recursive: true });
cpSync(join(ROOT, 'node_modules/mermaid/dist/mermaid.min.js'), join(OUT, 'static/mermaid.min.js'));
cpSync(join(ROOT, 'node_modules/mermaid/LICENSE'), join(OUT, 'static/mermaid-LICENSE.txt'));
for (const asset of usedAssets) {
  mkdirSync(dirname(join(OUT, asset)), { recursive: true });
  cpSync(join(ROOT, asset), join(OUT, asset));
  // 网页里显示的版本：缩到 1400 像素宽的 WebP。只在源文件更新过时重新生成（放在 assets/.cache，不进版本库）
  if (HAS_CWEBP && asset.endsWith('.png')) {
    const cached = join(ROOT, 'assets/.cache', asset.replace(/\.png$/, '.webp'));
    const { statSync } = await import('node:fs');
    if (!existsSync(cached) || statSync(cached).mtimeMs < statSync(join(ROOT, asset)).mtimeMs) {
      mkdirSync(dirname(cached), { recursive: true });
      execFileSync('cwebp', ['-quiet', '-q', '82', '-resize', '1400', '0', join(ROOT, asset), '-o', cached]);
    }
    cpSync(cached, join(OUT, asset.replace(/\.png$/, '.webp')));
  }
}
mkdirSync(join(OUT, 'engineering'), { recursive: true });
writeFileSync(join(OUT, 'engineering/architecture.canvas'), MAP.canvas);
writeFileSync(join(OUT, 'engineering/engineering-map.md'), MAP.markdown);
if (!ONLY) writeFileSync(join(OUT, 'static/search.json'), JSON.stringify(searchIndex));
console.log(`已生成 ${relative(ROOT, OUT)}：${pages.length} 个页面，${citations.length} 处 Pi 源码摘录，${interviews.length} 道面试题`);
