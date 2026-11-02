#!/usr/bin/env python3
"""Expand pending source markers, verify every rendered excerpt, then rebuild the evidence index."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import textwrap

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
source = parser.parse_args().source.resolve()
root = Path(__file__).resolve().parent.parent
repo = "https://github.com/earendil-works/pi"
commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip()
marker = re.compile(r"\[\[code:(.*?)\|(.*?)\|(\d+)\]\]")
excerpt = re.compile(r"^源码摘录：\[([^\]]+)\]\(" + re.escape(repo)
    + r"/blob/(?:main|[0-9a-f]{40})/([^#]+)#L(\d+)(?:-L\d+)?\)\n\n```[^\n]*\n(.*?)\n```", re.M | re.S)
records, documents = [], {}
for doc in sorted((root / "docs").glob("*.md")):
    def expand(match):
        path, anchor, size = match.groups()
        lines = (source / path).read_text().splitlines()
        start = next(i for i, line in enumerate(lines) if anchor in line)
        body = textwrap.dedent("\n".join(lines[start:start + int(size)]))
        return f"源码摘录：[{path}]({repo}/blob/{commit}/{path}#L{start+1})\n\n```ts\n{body}\n```"

    content = marker.sub(expand, doc.read_text())
    matches = list(excerpt.finditer(content))
    if len(matches) != content.count("源码摘录："):
        raise ValueError(f"{doc.name}: malformed excerpt label")
    for match in matches:
        label, path, line, code = match.groups()
        start, count = int(line), len(code.splitlines())
        raw = "\n".join((source / path).read_text().splitlines()[start-1:start-1+count])
        if label != path or textwrap.dedent(raw) != code:
            raise ValueError(f"{doc.name}: does not match {path}:{start}")
        records.append(dict(chapter=doc.name, path=path, start=start, count=count,
            anchor=code.splitlines()[0].strip(), sha256=hashlib.sha256(raw.encode()).hexdigest()))
    documents[doc] = content
# Leave all authored documents unchanged if any verification failed.
for doc, content in documents.items():
    if doc.read_text() != content:
        doc.write_text(content)
index = {"repository": repo, "inspected_commit": commit, "excerpts": records}
(root / "references/source-evidence.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n")
print(f"Verified {len(records)} source excerpts in {len(documents)} course documents")
