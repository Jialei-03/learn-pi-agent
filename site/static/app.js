// 网站交互：主题、目录、复制、搜索、消息回放。无依赖。
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const base = new URL('.', import.meta.url).href.replace(/static\/$/, '');

// ── 主题 ───────────────────────────────────────
$('.theme-toggle')?.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
});

// ── 移动端目录抽屉 ─────────────────────────────
const scrim = $('.scrim');
const setNav = open => { document.body.classList.toggle('nav-open', open); if (scrim) scrim.hidden = !open; };
$('.nav-toggle')?.addEventListener('click', () => setNav(!document.body.classList.contains('nav-open')));
scrim?.addEventListener('click', () => setNav(false));
{
  // 只滚动侧栏本身，让当前章节居中；不要用 scrollIntoView，它会连带滚动整个页面
  const sidebar = $('.sidebar');
  const current = $('.sidebar li.current');
  if (sidebar && current) sidebar.scrollTop = current.offsetTop - sidebar.clientHeight / 2;
}

// ── 复制与展开 ─────────────────────────────────
document.addEventListener('click', async event => {
  const copy = event.target.closest('.copy');
  if (copy) {
    const figure = copy.closest('figure');
    const text = copy.dataset.copy ?? $$('.line', figure).map(l => l.textContent).join('\n');
    try { await navigator.clipboard.writeText(text); copy.textContent = '已复制'; copy.classList.add('done'); }
    catch { copy.textContent = '复制失败'; }
    setTimeout(() => { copy.textContent = copy.dataset.copy ? '复制命令' : '复制'; copy.classList.remove('done'); }, 1400);
  }
  const expand = event.target.closest('.expand');
  if (expand) expand.closest('.src').classList.remove('collapsed');
});

// ── 本页目录高亮 ───────────────────────────────
const tocLinks = $$('.toc a[href^="#"]').filter(a => a.getAttribute('href').length > 1 && a.getAttribute('href') !== '#main');
if (tocLinks.length) {
  const targets = tocLinks.map(a => document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)))).filter(Boolean);
  const update = () => {
    const y = window.scrollY + 120;
    let current = targets[0];
    for (const t of targets) if (t.offsetTop <= y) current = t;
    for (const a of tocLinks) a.classList.toggle('active', a.getAttribute('href') === '#' + current?.id);
  };
  addEventListener('scroll', update, { passive: true });
  update();
}

// ── 搜索 ───────────────────────────────────────
const dialog = $('.search-dialog');
let index;
let selected = 0;
const openSearch = async () => {
  dialog.hidden = false;
  const input = $('input', dialog);
  input.value = '';
  input.focus();
  render('');
  index ??= await fetch(base + 'static/search.json').then(r => r.json()).catch(() => []);
  render(input.value);                     // 索引加载期间用户可能已经开始输入
};
const closeSearch = () => { dialog.hidden = true; };
const escapeHtml = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const mark = (text, q) => (q ? escapeHtml(text).replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<mark>${m}</mark>`) : escapeHtml(text));
function render(q) {
  const list = $('.search-results', dialog);
  const query = q.trim().toLowerCase();
  const hits = (index ?? [])
    .map(item => {
      const inTitle = (item.section ?? item.title).toLowerCase().indexOf(query);   // 小节条目只按小节标题匹配
      const inText = item.text.toLowerCase().indexOf(query);
      const score = !query ? (item.text ? 1 : 0) : inTitle >= 0 ? 3 - inTitle / 200 : inText >= 0 ? 1 : -1;
      return { item, score, inText };
    })
    .filter(h => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  selected = 0;
  if (!hits.length) { list.innerHTML = `<li class="empty">没有找到“${escapeHtml(q)}”。试试 steering、compaction、toolResult……</li>`; return; }
  list.innerHTML = hits.map(({ item, inText }, i) => {
    const snippet = query && inText >= 0 ? '…' + item.text.slice(Math.max(0, inText - 30), inText + 60) + '…' : '';
    const label = item.section ? `${item.chapter} · ${escapeHtml(item.title.split('：')[0])} › ${mark(item.section, query)}` : `${item.chapter} · ${mark(item.title, query)}`;
    return `<li class="${i === 0 ? 'sel' : ''}"><a href="${base}${item.url}"><span>${label}</span>${snippet ? `<small>${mark(snippet, query)}</small>` : ''}</a></li>`;
  }).join('');
}
if (dialog) {
  $$('[data-search-open]').forEach(b => b.addEventListener('click', openSearch));
  dialog.addEventListener('click', e => { if (e.target === dialog) closeSearch(); });
  $('input', dialog).addEventListener('input', e => render(e.target.value));
  addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); dialog.hidden ? openSearch() : closeSearch(); }
    if (dialog.hidden) return;
    const items = $$('.search-results li:not(.empty)', dialog);
    if (e.key === 'Escape') closeSearch();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((li, i) => li.classList.toggle('sel', i === selected));
      items[selected]?.scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Enter') $('a', items[selected])?.click();
  });
}

// ── 消息回放 ───────────────────────────────────
// 数据格式：{ title, subtitle, steps: [{ kind, label, explain, messages: [...], fresh: [索引], wire? }] }
const ICON = { request: '→', response: '←', tool: '⚙', end: '■' };
const ROLE = { system: 'system', user: 'user', assistant: 'assistant', toolResult: 'toolResult' };
function msgHtml(m, isNew) {
  const text = m.text ? `<div class="tp-text${m.text.length > 220 ? ' clip' : ''}">${escapeHtml(m.text)}</div>` : '';
  const calls = (m.calls ?? []).map(c => `<div class="tp-call">toolCall <b>${escapeHtml(c.name)}</b>${escapeHtml(JSON.stringify(c.args))}</div>`).join('');
  const label = m.role === 'toolResult' ? `toolResult · ${escapeHtml(m.name ?? '')}${m.error ? ' · isError' : ''}` : ROLE[m.role] ?? m.role;
  return `<div class="tp-msg ${m.role}${m.error ? ' error' : ''}${isNew ? ' new' : ''}"><div class="tp-role">${label}</div>${text}${calls}</div>`;
}
for (const el of $$('.trace-player')) {
  const data = JSON.parse($('script', el).textContent);
  let at = 0;
  let timer;
  const maxChars = Math.max(...data.steps.map(s => JSON.stringify(s.messages).length));
  el.innerHTML = `<div class="tp-head"><div><div class="tp-title">${escapeHtml(data.title)}</div>${data.subtitle ? `<div class="tp-sub">${escapeHtml(data.subtitle)}</div>` : ''}</div>
    <div class="tp-controls"><button class="tp-btn" data-act="prev">上一步</button><button class="tp-btn primary" data-act="next">下一步</button><button class="tp-btn" data-act="play">自动播放</button></div></div>
    <div class="tp-body"><ol class="tp-steps">${data.steps.map((s, i) => `<li data-i="${i}"><span class="tp-step-icon ${s.kind}">${ICON[s.kind] ?? '·'}</span><span class="tp-step-label">${escapeHtml(s.label)}</span></li>`).join('')}</ol><div class="tp-stage"></div></div>`;
  const stage = $('.tp-stage', el);
  const show = i => {
    at = Math.max(0, Math.min(data.steps.length - 1, i));
    const step = data.steps[at];
    const chars = JSON.stringify(step.messages).length;
    const fresh = new Set(step.fresh ?? []);
    stage.innerHTML = `<div class="tp-explain">${step.explain}</div>
      ${step.kind === 'request' ? `<div class="tp-meter">本次请求发送 ${step.messages.length} 条消息 · 约 ${chars.toLocaleString()} 字符<div class="tp-bar"><span style="width:${(chars / maxChars) * 100}%"></span></div></div>` : ''}
      <div class="tp-msgs">${step.messages.map((m, j) => msgHtml(m, fresh.has(j))).join('')}</div>
      ${step.wire ? `<details class="tp-wire"><summary>查看真实发送的请求体（${escapeHtml(step.wireLabel ?? 'JSON')}）</summary><pre>${escapeHtml(JSON.stringify(step.wire, null, 2))}</pre></details>` : ''}`;
    $$('.tp-steps li', el).forEach((li, j) => { li.classList.toggle('active', j === at); li.classList.toggle('done', j < at); });
    $('[data-act="prev"]', el).disabled = at === 0;
    $('[data-act="next"]', el).disabled = at === data.steps.length - 1;
    $('.tp-steps li.active', el)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const stop = () => { clearInterval(timer); timer = undefined; $('[data-act="play"]', el).textContent = '自动播放'; };
  el.addEventListener('click', e => {
    const li = e.target.closest('.tp-steps li');
    if (li) { stop(); show(Number(li.dataset.i)); }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'prev') { stop(); show(at - 1); }
    if (act === 'next') { stop(); show(at + 1); }
    if (act === 'play') {
      if (timer) return stop();
      if (at === data.steps.length - 1) show(0);
      e.target.textContent = '暂停';
      timer = setInterval(() => (at >= data.steps.length - 1 ? stop() : show(at + 1)), 2200);
    }
  });
  show(0);
}
