import { mountExperiments } from './experiments.js';
const app = document.querySelector('#app');
const nav = document.querySelector('#nav');
const outline = document.querySelector('#outline');
const dialog = document.querySelector('#search-dialog');
const search = document.querySelector('#search-input');
const results = document.querySelector('#search-results');
let pages = [], chapters = [], current = 'home';
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const bySlug = slug => pages.find(p => p.slug === slug);
const route = slug => '#/' + slug;
const shortTitle = title => title.replace(/^(第\s*\d+\s*章[：:]?\s*)/, '').split(/[：:]/)[0];
// Offer scroll and wrap controls only when the content exceeds its reading column.
const readingSizes = new ResizeObserver(entries => {
  for (const {target} of entries) {
    const wide = target.scrollWidth > target.clientWidth + 1;
    if (target.matches('pre')) {
      const toggle = target.parentElement.querySelector('[data-wrap-code]');
      toggle.hidden = !wide && toggle.getAttribute('aria-pressed') !== 'true';
      continue;
    }
    target.previousElementSibling.hidden = !wide;
    if (wide) {
      target.tabIndex = 0;
      target.setAttribute('role', 'region');
      target.setAttribute('aria-label', '表格，可横向滚动');
    } else {
      target.removeAttribute('tabindex');
      target.removeAttribute('role');
      target.removeAttribute('aria-label');
    }
  }
});
function group(label, entries) {
  return `<div class="nav-group"><div class="nav-label">${e(label)}</div>${entries.map(p => `<a class="nav-link ${current === p.slug ? 'active' : ''}" href="${route(p.slug)}" ${current === p.slug ? 'aria-current="page"' : ''}><span class="nav-no">${p.number ? String(p.number).padStart(2,'0') : '·'}</span><span>${e(shortTitle(p.title))}</span></a>`).join('')}</div>`;
}
function renderNav() {
  const guides = ['home','00-source-learning-path','00-course-structure'].map(s => s === 'home' ? {slug:'home', title:'课程首页'} : bySlug(s)).filter(Boolean);
  const refs = ['source-map','glossary','papers','version-baseline'].map(bySlug).filter(Boolean);
  nav.innerHTML = group('开始学习',guides) + group('基础与运行',chapters.slice(0,4)) + group('上下文与能力',chapters.slice(4,9)) + group('工作流与编排',chapters.slice(9,14)) + group('工程实践',chapters.slice(14)) + group('参考资料',refs);
}
function home() {
  document.title = 'Learn Pi Agent · 源码学习手册';
  outline.innerHTML = '';
  const topics = [
    ['01', '跟踪工具循环', '让 Pi 读一次 README，在图中切换成功、文件缺失和截断三种情形。', chapters[0]],
    ['02', '观察上下文压缩', '沿一个调用和一份工具结果，找到历史记录的保留边界。', chapters[5]],
    ['03', '运行完整 SDK 会话', '创建 Session，订阅消息，把每次事件和会话记录对起来。', chapters[12]],
  ];
  app.innerHTML = `<div class="home"><section class="book-intro"><div class="home-intro">
    <div class="book-kicker">PI · SOURCE HANDBOOK</div><h1>Pi Agent<br>源码学习手册</h1>
    <p>从读取一份 README 开始，看清消息、工具和会话怎样协作。</p>
    <div class="home-actions"><a class="primary-btn" href="${route(chapters[0].slug)}">从第一章开始 →</a>
    <a class="continue-link" href="${route('00-source-learning-path')}">学习路线 ›</a></div></div>
    <img src="./assets/mox-mechanisms/loop.webp" width="1536" height="1024" alt="Mox 把模型的工具请求送进 read，再把文件内容送回模型"></section>
    <section class="home-section"><div class="section-head"><div><h2>从三个案例进入</h2>
    <p>每个案例都能找到对应的程序与运行结果。</p></div></div>
    <div class="learning-steps">${topics.map(([n,title,description,page])=>`<a href="${route(page.slug)}"><span class="step-num">${n}</span><div><h3>${title}</h3><p>${description}</p></div><span class="step-arrow">↗</span></a>`).join('')}</div></section>
    <section class="home-section"><div class="section-head"><h2>全书目录</h2><a class="section-link" href="${route('source-map')}">按源码查找 ›</a></div>
    <div class="chapter-grid">${chapters.map(p=>`<a class="chapter-tile" href="${route(p.slug)}"><span class="tile-num">${String(p.number).padStart(2,'0')}</span><span class="tile-title">${e(p.title)}</span><span class="tile-arrow">›</span></a>`).join('')}</div></section></div>`;
}
function article(page, section) {
  document.title = `${page.title} · Learn Pi Agent`;
  const label = page.kind === 'chapter' ? `第 ${String(page.number).padStart(2,'0')} 章` : page.kind === 'reference' ? '参考资料' : '学习指南';

  let prev = null, next = null;
  if(page.kind==='chapter'){const n=chapters.indexOf(page); prev=chapters[n-1]; next=chapters[n+1];}
  app.innerHTML = `<div class="reading-layout"><div class="breadcrumb"><a href="#/home">课程</a><span aria-hidden="true">/</span><span>${e(label)}</span></div><header class="reading-header"><h1>${e(page.title)}</h1></header><article class="article" id="article">${page.html}</article>${prev||next?`<nav class="next-row" aria-label="相邻章节">${prev?`<a href="${route(prev.slug)}"><small>← 上一章</small>${e(shortTitle(prev.title))}</a>`:''}${next?`<a href="${route(next.slug)}"><small>下一章 →</small>${e(shortTitle(next.title))}</a>`:''}</nav>`:''}</div>`;
  mountExperiments(document.getElementById('article'));
  app.querySelectorAll('.table-block > .table-scroll, .code-block:has([data-wrap-code]) > pre')
    .forEach(block => readingSizes.observe(block));
  const headings = [...app.querySelectorAll('.article h2, .article h3')];
  const sectionLinks = headings.map(h=>`<a class="${h.tagName==='H3'?'sub':''}" href="${route(page.slug)}?section=${encodeURIComponent(h.id)}">${e(h.textContent)}</a>`).join('');
  outline.innerHTML = headings.length ? `<div class="outline-title">本页目录</div>${sectionLinks}` : '';
  if (headings.length) document.querySelector('.reading-header').insertAdjacentHTML('afterend', `<details class="compact-outline"><summary>本页目录</summary><nav aria-label="本页章节">${sectionLinks}</nav></details>`);
  if(section) requestAnimationFrame(()=>document.getElementById(section)?.scrollIntoView());
}
function render(){
  const raw=location.hash.startsWith('#/')?location.hash.slice(2):'home';
  const [slug,query='']=raw.split('?');
  if (slug === current && query && document.getElementById('article')) {
    const target = document.getElementById(new URLSearchParams(query).get('section'));
    if (target) {
      const menu = document.querySelector('.compact-outline');
      if (menu) menu.open = false;
      target.scrollIntoView({behavior:'instant'});
      return;
    }
  }
  current=slug || 'home';
  readingSizes.disconnect();
  const p=bySlug(current);
  if(current==='home') home(); else if(p) article(p,new URLSearchParams(query).get('section')); else {current='home';home();}
  renderNav(); closeMenu(); if(!query) window.scrollTo({top:0,behavior:'instant'});
}
const narrowLayout = matchMedia('(max-width: 1023px)');
function setMenu(open){
  document.querySelector('#sidebar').classList.toggle('open',open);
  document.querySelector('#sidebar').inert = narrowLayout.matches && !open;
  document.querySelector('#main').inert = narrowLayout.matches && open;
  document.querySelector('#veil').classList.toggle('visible',open);
  document.querySelector('#menu-button').setAttribute('aria-expanded',String(open));
  document.querySelector('#menu-button').setAttribute('aria-label',open?'关闭目录':'打开目录');
  document.body.classList.toggle('menu-open',open && narrowLayout.matches);
}
function openMenu(){setMenu(true);}
function closeMenu(){setMenu(false);}
narrowLayout.addEventListener('change',closeMenu);
closeMenu();
function doSearch(){
  const q=search.value.trim().toLowerCase();
  if(!q){results.innerHTML='<div class="search-result"><small>试试「Agent Loop」「工具」「Session」或「扩展」</small></div>';return;}
  const hits = pages.flatMap(page => {
    const titleHit = page.title.toLowerCase().includes(q);
    const parts = (page.sections || []).map(part => {
      const offset = part.text.toLowerCase().indexOf(q);
      const headingHit = part.title.toLowerCase().includes(q);
      if (offset < 0 && !headingHit) return null;
      const from = Math.max(0, offset - 24);
      return { score: headingHit ? 6 : 2, title: part.title, section: part.id,
        preview: (from ? '…' : '') + part.text.slice(from, from + 92) };
    }).filter(Boolean).sort((a,b) => b.score - a.score);
    if (titleHit) parts.unshift({ score: 8, title: '', preview: page.title, section: '' });
    if (!parts.length && page.text.toLowerCase().includes(q)) parts.push({ score: 1, title: '', preview: page.title, section: '' });
    return parts.slice(0,2).map(hit => ({ ...hit, page }));
  }).sort((a,b) => b.score - a.score).slice(0,14);
  results.innerHTML = hits.length ? hits.map(hit => {
    const url = route(hit.page.slug) + (hit.section ? '?section=' + encodeURIComponent(hit.section) : '');
    return `<a class="search-result" href="${url}"><strong>${e(hit.title || hit.page.title)}</strong>
      <small>${e(hit.title ? shortTitle(hit.page.title) + ' · ' : '')}${e(hit.preview)}</small></a>`;
  }).join('') : '<div class="search-result"><small>没有找到相关内容，请尝试其他关键词。</small></div>';
}
document.querySelector('#menu-button').addEventListener('click',()=>document.querySelector('#sidebar').classList.contains('open')?closeMenu():openMenu());
document.querySelector('#veil').addEventListener('click',closeMenu);
nav.addEventListener('click',ev=>{if(ev.target.closest('a'))closeMenu();});
document.querySelector('#search-open').addEventListener('click',()=>{dialog.showModal(); search.value=''; doSearch(); search.focus()});
document.querySelector('#search-close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',ev=>{if(ev.target===dialog)dialog.close(); if(ev.target.closest('.search-result[href]'))dialog.close()});
search.addEventListener('input',doSearch);
search.addEventListener('keydown',ev=>{if(ev.key==='Enter'){const a=results.querySelector('a'); if(a){dialog.close();location.hash=a.hash;}}});
document.addEventListener('keydown',ev=>{if(ev.key==='Escape'&&document.body.classList.contains('menu-open')){closeMenu();document.querySelector('#menu-button').focus();}if((ev.metaKey||ev.ctrlKey)&&ev.key.toLowerCase()==='k'){ev.preventDefault();if(!dialog.open)document.querySelector('#search-open').click();}});
document.addEventListener('click',ev=>{const a=ev.target.closest('a[href^="#"]');if(!a)return;const href=a.getAttribute('href');if(href.startsWith('#/'))return;ev.preventDefault();const target=document.getElementById(decodeURIComponent(href.slice(1)));const compact=a.closest('.compact-outline');if(compact)compact.open=false;if(target){target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});if(a.classList.contains('skip-link'))target.focus({preventScroll:true});}});
window.addEventListener('hashchange',render);
fetch('./course.json', {cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('无法加载课程');return r.json()}).then(data=>{pages=data;chapters=pages.filter(p=>p.kind==='chapter').sort((a,b)=>a.number-b.number);render()}).catch(()=>{app.innerHTML='<div class="loading">课程内容加载失败。请通过网站地址或本地服务打开。</div>'});

document.addEventListener('click', async (event) => {
  const wrap = event.target.closest('[data-wrap-code]');
  if (wrap) {
    const block = wrap.closest('.code-block');
    const active = block.classList.toggle('wrap-lines');
    wrap.setAttribute('aria-pressed', String(active));
    const pre = block.querySelector('pre');
    if (!active && pre.scrollWidth <= pre.clientWidth + 1) wrap.hidden = true;
    return;
  }
  const button = event.target.closest('[data-copy-code]');
  if (!button) return;
  try {
    await navigator.clipboard.writeText(button.closest('.code-block').querySelector('code').textContent);
    button.textContent = '已复制';
    setTimeout(() => { button.textContent = '复制代码'; }, 1500);
  } catch { button.textContent = '请选中代码复制'; }
});
