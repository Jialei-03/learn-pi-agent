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
  app.innerHTML = `<div class="home"><div class="home-intro"><div class="eyebrow">LEARN PI AGENT</div><h1>把 Agent 看透。<br><span>从源码开始。</span></h1><p>从一次模型调用，到完整的 Agent 系统。<br>沿着真实代码，理解每一个关键机制。</p><div class="home-actions"><a class="primary-btn" href="${route('00-source-learning-path')}">开始学习 <span>→</span></a><a class="continue-link" href="${route('01-from-llm-to-agent')}">阅读第一章 <span>›</span></a></div></div><div class="hero-visual" aria-label="Agent 从用户输入到模型和工具的运行关系"><div class="visual-caption">PI AGENT <span> / </span> SYSTEM OVERVIEW</div><div class="flow-track"><div class="flow-node"><span class="node-glyph">↗</span><span>输入</span></div><div class="flow-connector"></div><div class="flow-node focus-node"><span class="node-glyph">π</span><span>Agent Loop</span></div><div class="flow-connector"></div><div class="flow-node"><span class="node-glyph">⌘</span><span>工具</span></div></div><div class="visual-caption visual-bottom">MODEL <span>·</span> CONTEXT <span>·</span> TOOLS <span>·</span> SESSION</div></div><section class="home-section"><div class="section-head"><div><h2>先建立全局，再深入细节。</h2><p>一条围绕真实源码设计的学习路线。</p></div><a href="${route('00-source-learning-path')}" class="section-link">查看完整路线 <span>›</span></a></div><div class="learning-steps"><a href="${route('00-source-learning-path')}"><span class="step-num">01</span><div><h3>认识整体架构</h3><p>理解 Pi 各层如何连接，从系统全貌开始。</p></div><span class="step-arrow">↗</span></a><a href="${route('03-agent-loop-state-machine-and-stopping')}"><span class="step-num">02</span><div><h3>追踪一次请求</h3><p>走进模型、Agent Loop、工具与会话。</p></div><span class="step-arrow">↗</span></a><a href="${route('09-extensions-plugins-and-packages')}"><span class="step-num">03</span><div><h3>理解关键机制</h3><p>阅读上下文、扩展和工程边界的具体实现。</p></div><span class="step-arrow">↗</span></a></div></section><section class="home-section chapters-section"><div class="section-head"><div><h2>十八章，一步步读懂。</h2><p>概念、代码与工程实践，都在这里。</p></div><a class="section-link" href="${route('00-course-structure')}">课程结构 <span>›</span></a></div><div class="chapter-grid">${chapters.map(p=>`<a class="chapter-tile" href="${route(p.slug)}"><span class="tile-num">${String(p.number).padStart(2,'0')}</span><span class="tile-title">${e(p.title)}</span><span class="tile-arrow">›</span></a>`).join('')}</div><p class="more-note">十八章课程，沿真实调用链理解 Pi 的实现。</p></section></div>`;
}
function article(page, section) {
  document.title = `${page.title} · Learn Pi Agent`;
  const label = page.kind === 'chapter' ? `第 ${String(page.number).padStart(2,'0')} 章` : page.kind === 'reference' ? '参考资料' : '学习指南';

  let prev = null, next = null;
  if(page.kind==='chapter'){const n=chapters.indexOf(page); prev=chapters[n-1]; next=chapters[n+1];}
  app.innerHTML = `<div class="reading-layout"><div class="breadcrumb"><a href="#/home">课程</a><span aria-hidden="true">/</span><span>${e(label)}</span></div><header class="reading-header"><h1>${e(page.title)}</h1></header><article class="article" id="article">${page.html}</article>${prev||next?`<nav class="next-row" aria-label="相邻章节">${prev?`<a href="${route(prev.slug)}"><small>← 上一章</small>${e(shortTitle(prev.title))}</a>`:''}${next?`<a href="${route(next.slug)}"><small>下一章 →</small>${e(shortTitle(next.title))}</a>`:''}</nav>`:''}</div>`;
  const headings = [...app.querySelectorAll('.article h2, .article h3')];
  const sectionLinks = headings.map(h=>`<a class="${h.tagName==='H3'?'sub':''}" href="#${e(h.id)}">${e(h.textContent)}</a>`).join('');
  outline.innerHTML = headings.length ? `<div class="outline-title">本页目录</div>${sectionLinks}` : '';
  if (headings.length) document.querySelector('.reading-header').insertAdjacentHTML('afterend', `<details class="compact-outline"><summary>本页目录</summary><nav aria-label="本页章节">${sectionLinks}</nav></details>`);
  if(section) requestAnimationFrame(()=>document.getElementById(section)?.scrollIntoView());
}
function render(){
  const raw=location.hash.startsWith('#/')?location.hash.slice(2):'home';
  const [slug,query='']=raw.split('?');
  current=slug || 'home';
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
  const hits=pages.map(p=>({p,score:(p.title.toLowerCase().includes(q)?100:0)+(p.text.toLowerCase().includes(q)?1:0),pos:p.text.toLowerCase().indexOf(q)})).filter(x=>x.score).sort((a,b)=>b.score-a.score).slice(0,12);
  results.innerHTML=hits.length?hits.map(({p,pos})=>`<a class="search-result" href="${route(p.slug)}"><strong>${e(p.title)}</strong><small>${e(pos>=0 ? '…'+p.text.slice(Math.max(0,pos-35),pos+100)+'…' : p.source)}</small></a>`).join(''):'<div class="search-result"><small>没有找到相关内容，请尝试其他关键词。</small></div>';
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
  const button = event.target.closest('[data-copy-code]');
  if (!button) return;
  try {
    await navigator.clipboard.writeText(button.closest('.code-block').querySelector('code').textContent);
    button.textContent = '已复制';
    setTimeout(() => { button.textContent = '复制代码'; }, 1500);
  } catch { button.textContent = '请选中代码复制'; }
});
