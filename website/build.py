#!/usr/bin/env python3
"""Build the local course sources into the static reading site."""
import json, re, shutil, hashlib, subprocess
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
for name in ('index.html', 'style.css', 'app.js', 'experiments.js'):
    shutil.copy2(Path(__file__).resolve().parent/name, OUT/name)
# Build the same runtime used by the Node example, then publish the tiny
# projection fixture from Pi's own cut-point and projection functions.
example = ROOT / 'examples/read-loop'
subprocess.run(['npm', 'run', 'build:web'], cwd=example, check=True)
projection = subprocess.check_output(['node', 'projection.mjs'], cwd=example)
(OUT / 'projection.json').write_bytes(projection)
(OUT / 'style.css').write_text((OUT / 'style.css').read_text() + '\n' + (ROOT / 'website/experiments.css').read_text())
shutil.copyfile(example / 'THIRD-PARTY.txt', OUT / 'read-loop.LICENSE.txt')
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
        if language in ('ts','typescript','js','javascript','json','jsonl','bash','python','yaml','xml','markdown'):
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
    sections=[]
    for heading in soup.select('h2,h3'):
        parts=[]
        for node in heading.next_siblings:
            if node.name in ('h2','h3'): break
            if node.name: parts.append(node.get_text(' ', strip=True))
        sections.append({'id':heading['id'], 'title':heading.get_text(' ', strip=True), 'text':' '.join(parts)})
    # Keep the question and its derivation readable on GitHub. In the book,
    # leave a pause between them and let the reader reveal the reasoning.
    for quote_block in soup.select('blockquote'):
        paragraphs = quote_block.find_all('p', recursive=False)
        if len(paragraphs) != 2: continue
        question, answer = paragraphs
        if not (question.strong and question.strong.get_text() == '先预测' and
                answer.strong and answer.strong.get_text() == '核对推导'): continue
        quote_block.name = 'aside'
        quote_block['class'] = ['prediction']
        quote_block['aria-label'] = '用本章机制做个判断'
        answer.strong.decompose()
        details = soup.new_tag('details')
        summary = soup.new_tag('summary')
        summary.string = '核对推导'
        details.append(summary)
        details.append(answer.extract())
        quote_block.append(details)
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
                  'html':str(soup),'text':search_text, 'sections':sections, 'source':str(p.relative_to(ROOT))})
# Fingerprint imported modules too, so an updated article cannot accidentally
# run an older diagram from the browser cache.
def revision(filename):
    return hashlib.sha256((OUT / filename).read_bytes()).hexdigest()[:12]

def version_imports(filename, dependencies):
    path = OUT / filename
    content = path.read_text()
    for dependency in dependencies:
        content = content.replace('./' + dependency, './' + dependency + '?v=' + revision(dependency))
    path.write_text(content)

version_imports('experiments.js', ['read-loop.mjs', 'projection.json'])
version_imports('app.js', ['experiments.js'])
version_imports('index.html', ['app.js', 'style.css'])
(OUT/'course.json').write_text(json.dumps(items,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print(f'Built {len(items)} pages to {OUT}')
