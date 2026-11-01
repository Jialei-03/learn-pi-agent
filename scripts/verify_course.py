#!/usr/bin/env python3
"""Check course links, source evidence, images, and rendered data."""
from pathlib import Path
from urllib.parse import unquote
import argparse, hashlib, json, re, textwrap
p=argparse.ArgumentParser();p.add_argument('source',type=Path);args=p.parse_args()
root=Path(__file__).resolve().parent.parent;source=args.source.resolve();errors=[];links=0
files=[root/'README.md']+list((root/'docs').glob('*.md'))+list((root/'references').glob('*.md'))
for file in files:
 text=file.read_text()
 if '[[code:' in text: errors.append(f'{file.name}: unresolved source marker')
 if text.count('```')%2: errors.append(f'{file.name}: unbalanced code fence')
 for target in re.findall(r'\]\(([^)]+)\)',text):
  links+=1
  if target.startswith('https://github.com/earendil-works/pi/'):
   m=re.match(r'https://github.com/earendil-works/pi/(?:blob|tree)/main/([^#]+)(?:#L(\d+))?',target)
   if m:
    path=source/unquote(m[1])
    if not path.exists(): errors.append(f'{file.name}: missing source {m[1]}')
    elif m[2] and path.is_file() and int(m[2])>len(path.read_text().splitlines()): errors.append(f'{file.name}: source line out of range')
  elif not target.startswith(('http:','https:','mailto:','#')):
   path=(file.parent/unquote(target.split('#')[0])).resolve()
   if not path.exists(): errors.append(f'{file.name}: missing local link {target}')
evidence=json.loads((root/'references/source-evidence.json').read_text())
for record in evidence['excerpts']:
 lines=(source/record['path']).read_text().splitlines();a=record['start']-1
 raw='\n'.join(lines[a:a+record['count']])
 if hashlib.sha256(raw.encode()).hexdigest()!=record['sha256']: errors.append(f"Source excerpt changed: {record['path']}:{a+1}")
 if textwrap.dedent(raw) not in (root/'docs'/record['chapter']).read_text(): errors.append(f"Excerpt missing in chapter: {record['chapter']}")
print(f'Checked {len(files)} documents, {links} links, {len(evidence["excerpts"])} exact source excerpts')
for error in errors: print(error)
raise SystemExit(bool(errors))
