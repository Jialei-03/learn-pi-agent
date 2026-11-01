#!/usr/bin/env python3
"""Expand authored source markers and retain their evidence for maintenance."""
from pathlib import Path
import argparse, hashlib, json, re, subprocess, textwrap
p=argparse.ArgumentParser();p.add_argument('source',type=Path);args=p.parse_args()
root=Path(__file__).resolve().parent.parent
source=args.source.resolve()
pattern=re.compile(r'\[\[code:(.*?)\|(.*?)\|(\d+)\]\]')
records=[]; outputs={}
for file in sorted((root/'docs').glob('*.md')):
 def replace(m):
  path, anchor, count=m.group(1),m.group(2),int(m.group(3))
  lines=(source/path).read_text().splitlines()
  matches=[i for i,line in enumerate(lines) if anchor in line]
  if not matches: raise ValueError(f'{file.name}: missing {anchor!r} in {path}')
  start=matches[0]; raw='\n'.join(lines[start:start+count]); code=textwrap.dedent(raw)
  records.append({'chapter':file.name,'path':path,'start':start+1,'count':count,'anchor':anchor,'sha256':hashlib.sha256(raw.encode()).hexdigest()})
  return f'源码摘录：[{path}](https://github.com/earendil-works/pi/blob/main/{path}#L{start+1})\n\n```ts\n{code}\n```'
 outputs[file]=pattern.sub(replace,file.read_text())
# Validate every marker before changing any authored document.
for file, content in outputs.items(): file.write_text(content)
if not records:
    print('No pending source markers; existing evidence retained')
    raise SystemExit(0)
commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip()
existing_path=root/'references/source-evidence.json'
if existing_path.exists():
    previous=json.loads(existing_path.read_text()).get('excerpts',[])
    keys={(x['chapter'],x['path'],x['start']) for x in records}
    records=[x for x in previous if (x['chapter'],x['path'],x['start']) not in keys]+records
(root/'references/source-evidence.json').write_text(json.dumps({'repository':'https://github.com/earendil-works/pi','inspected_commit':commit,'excerpts':records},ensure_ascii=False,indent=2)+'\n')
print(f'Expanded {len(records)} verified excerpts in {len(outputs)} documents')
