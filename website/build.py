#!/usr/bin/env python3
"""Build the local course sources into the static reading site."""
import json, re, shutil, hashlib
from pathlib import Path
from urllib.parse import quote, unquote
from markdown_it import MarkdownIt
from bs4 import BeautifulSoup
from PIL import Image
from pygments import highlight
from pygments.lexers import get_lexer_by_name
from pygments.formatters import HtmlFormatter

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(__file__).resolve().parent / 'dist'
OUT.mkdir(exist_ok=True)
shutil.rmtree(OUT/'assets', ignore_errors=True)
(OUT/'assets').mkdir(exist_ok=True)
for name in ('index.html', 'style.css', 'app.js'):
    shutil.copy2(Path(__file__).resolve().parent/name, OUT/name)
hero = ROOT/'assets/mox-illustrations/mox-learning-path.png'
hero_out = OUT/'assets/mox-illustrations/mox-learning-path.webp'
hero_out.parent.mkdir(parents=True, exist_ok=True)
if not hero_out.exists() or hero_out.stat().st_mtime < hero.stat().st_mtime:
    with Image.open(hero) as image:
        image.thumbnail((1200,1200))
        image.save(hero_out, 'WEBP', quality=82, method=4)
files = sorted((ROOT/'docs').glob('*.md')) + sorted((ROOT/'references').glob('*.md'))
slugs = {p.resolve(): p.stem for p in files}
md = MarkdownIt('commonmark', {'html': False, 'linkify': False}).enable(['table', 'strikethrough'])
items=[]
for p in files:
    source=p.read_text(encoding='utf-8')
    soup=BeautifulSoup(md.render(source), 'html.parser')
    search_text=soup.get_text(' ',strip=True)
    for code in soup.select('pre > code'):
        classes=code.get('class', [])
        language=next((x.removeprefix('language-') for x in classes if x.startswith('language-')), 'text')
        if language in ('ts','typescript','json','bash','python','yaml','xml'):
            try:
                rendered=highlight(code.get_text(), get_lexer_by_name(language), HtmlFormatter(nowrap=True))
                code.clear()
                for child in list(BeautifulSoup(rendered, 'html.parser').contents): code.append(child)
            except ValueError: pass
        pre=code.parent
        block=soup.new_tag('div', attrs={'class':'code-block'})
        pre.wrap(block)
        toolbar=soup.new_tag('div', attrs={'class':'code-toolbar'})
        label=soup.new_tag('span'); label.string=language.upper(); toolbar.append(label)
        button=soup.new_tag('button', attrs={'type':'button','data-copy-code':'','aria-label':'复制代码'})
        button.string='复制代码'; toolbar.append(button); block.insert(0, toolbar)
    seen={}
    for h in soup.select('h1,h2,h3,h4'):
        title=h.get_text(' ',strip=True)
        base=re.sub(r'[^\w\-\u4e00-\u9fff ]','',title.lower()).strip().replace(' ', '-') or 'section'
        n=seen.get(base,0); seen[base]=n+1
        h['id']=base + ('-'+str(n) if n else '')
    for a in soup.select('a[href]'):
        href=a['href']
        if href.startswith(('http://','https://','mailto:')):
            a['target']='_blank'; a['rel']='noopener noreferrer'
        elif not href.startswith('#'):
            parts=href.split('#',1); target=(p.parent/unquote(parts[0])).resolve()
            if target in slugs:
                a['href']='#/'+slugs[target]+(('?section='+quote(parts[1])) if len(parts)>1 else '')
            else:
                try:
                    rel=target.relative_to(ROOT).as_posix()
                    a['href']='https://github.com/Jialei-03/learn-pi-agent/blob/main/'+rel + (('#'+parts[1]) if len(parts)>1 else '')
                    a['target']='_blank'; a['rel']='noopener noreferrer'
                except ValueError: pass
    for img in soup.select('img[src]'):
        src=img['src']
        if src.startswith(('http://','https://','data:')): continue
        path=(p.parent/unquote(src)).resolve()
        if not path.is_file(): continue
        try: rel=path.relative_to(ROOT/'assets')
        except ValueError: continue
        dest=(OUT/'assets'/rel)
        if path.suffix.lower() in ('.png','.jpg','.jpeg'):
            dest=dest.with_suffix('.webp'); dest.parent.mkdir(parents=True,exist_ok=True)
            if not dest.exists() or dest.stat().st_mtime < path.stat().st_mtime:
                with Image.open(path) as im:
                    im.thumbnail((1800,1800)); im.save(dest,'WEBP',quality=82,method=4)
        else:
            dest.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(path,dest)
        img['src']=dest.relative_to(OUT).as_posix(); img['loading']='lazy'; img['decoding']='async'
    for table in soup.select('table'):
        wrapper=soup.new_tag('div',**{'class':'table-scroll'}); table.wrap(wrapper)
    title=soup.h1.get_text(' ',strip=True) if soup.h1 else p.stem
    kind='chapter' if re.match(r'^\d\d-',p.name) and not p.name.startswith('00-') else ('guide' if p.parent.name=='docs' else 'reference')
    items.append({'slug':p.stem,'title':title,'kind':kind,'number':int(p.name[:2]) if kind=='chapter' else None,
                  'html':str(soup),'text':search_text, 'source':str(p.relative_to(ROOT))})
digest=hashlib.sha256(((OUT/'app.js').read_text()+(OUT/'style.css').read_text()).encode()).hexdigest()[:12]
html=(OUT/'index.html').read_text().replace('./app.js', './app.js?v='+digest).replace('./style.css', './style.css?v='+digest)
(OUT/'index.html').write_text(html)
(OUT/'course.json').write_text(json.dumps(items,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print(f'Built {len(items)} pages to {OUT}')
