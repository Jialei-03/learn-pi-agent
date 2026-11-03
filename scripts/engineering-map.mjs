// Source-backed map renderer. Produces web, Mermaid and JSON Canvas from one input.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const esc = value => String(value).replace(/[&<>\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const id = value => createHash('sha256').update(value).digest('hex').slice(0, 16);

export function engineeringMap(root) {
  const data = JSON.parse(readFileSync(resolve(root, 'engineering/map.json'), 'utf8'));
  const source = resolve(process.env[data.source.env] ?? resolve(root, data.source.directory));
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (git(['rev-parse', 'HEAD']).trim() !== data.source.commit) throw new Error(`${data.title}: map source revision mismatch`);
  for (const group of data.groups) for (const node of group.nodes) {
    const content = git(['show', `${data.source.commit}:${node.file}`]);
    const lines = content.split('\n');
    if (node.anchor) {
      const hits = lines.flatMap((line, n) => line.includes(node.anchor) ? [n + 1] : []);
      if (hits.length !== 1) throw new Error(`${node.file}: map anchor is not unique`);
      node.start = hits[0]; node.end = Math.min(lines.length, node.start + node.span - 1);
    }
    if (!(node.start >= 1 && node.end >= node.start && node.end <= lines.length)) throw new Error(`${node.file}: invalid map line range`);
    node.url = `${data.source.repo}/blob/${data.source.commit}/${node.file}#L${node.start}-L${node.end}`;
  }
  const canvas = { nodes: [], edges: [] };
  const rootId = id(data.title);
  let y = 0;
  for (const group of data.groups) {
    const center = y + (group.nodes.length * 150 - 50) / 2;
    const groupId = id(group.label);
    canvas.nodes.push({ id: groupId, type: 'text', x: 400, y: Math.round(center - 50), width: 260, height: 100, color: '2', text: `## ${group.label}\n\n阅读主题` });
    canvas.edges.push({ id: id(rootId + groupId), fromNode: rootId, fromSide: 'right', toNode: groupId, toSide: 'left', toEnd: 'none', label: '主题' });
    for (const node of group.nodes) {
      const nodeId = id(node.file + node.label);
      canvas.nodes.push({ id: nodeId, type: 'text', x: 800, y, width: 460, height: 100, text: `## ${node.label}\n\n[${node.file}:${node.start}–${node.end}](${node.url})` });
      canvas.edges.push({ id: id(groupId + nodeId), fromNode: groupId, fromSide: 'right', toNode: nodeId, toSide: 'left', toEnd: 'arrow', label: '实现入口' });
      y += 150;
    }
    y += 80;
  }
  canvas.nodes.unshift({ id: rootId, type: 'text', x: 0, y: Math.round(y / 2 - 80), width: 280, height: 160, color: '5', text: `# ${data.title}\n\n${data.source.version}\n\n固定提交 ${data.source.commit}\n\n${data.edgeSemantics}` });
  const ids = [...canvas.nodes, ...canvas.edges].map(n => n.id);
  if (new Set(ids).size !== ids.length) throw new Error('Canvas IDs are not unique');
  const nodeIds = new Set(canvas.nodes.map(n => n.id));
  for (const edge of canvas.edges) if (!nodeIds.has(edge.fromNode) || !nodeIds.has(edge.toNode)) throw new Error('Dangling Canvas edge');

  const mermaid = ['mindmap', `  root((${data.title}))`, ...data.groups.flatMap(g => [`    ${g.label}`, ...g.nodes.map(n => `      ${n.label}`)])].join('\n');
  const markdown = `# ${data.title}\n\n版本：${data.source.version} · 固定提交：[${data.source.commit.slice(0, 7)}](${data.source.repo}/tree/${data.source.commit})。\n\n${data.edgeSemantics}。每个实现入口都在构建时核对文件与行号。\n\n\`\`\`mermaid\n${mermaid}\n\`\`\`\n\n## 源码入口\n\n` + data.groups.map(g => `### ${g.label}\n\n` + g.nodes.map(n => `- [${n.label} · ${n.file}:${n.start}–${n.end}](${n.url})`).join('\n')).join('\n\n') + '\n';
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(data.title)}</title><style>
  *{box-sizing:border-box}body{margin:0;background:#fafafa;color:#252525;font:15px/1.6 system-ui,"PingFang SC",sans-serif}header{padding:22px 28px;border-bottom:1px solid #ddd;background:white}h1{font-size:24px;margin:8px 0}p{margin:5px 0;color:#666}a{color:#9b3c17}nav{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:18px}button,select{font:inherit;padding:6px 12px;background:white;border:1px solid #ccc;border-radius:6px}button{cursor:pointer}.viewer{overflow:auto;height:calc(100vh - 240px);min-height:420px;padding:24px}.viewer svg{height:auto;display:block}svg text{font-family:system-ui,"PingFang SC",sans-serif}.map-node:hover rect{stroke:#e56c32;stroke-width:2}.small{font-size:12px}footer{padding:12px 28px;color:#777;font-size:12px} @media(prefers-color-scheme:dark){body{background:#161618;color:#eee}header,button,select{background:#202024;color:#eee}header{border-color:#38383c}a{color:#f6a77e}}
  </style><header><a href="index.html">← 返回课程</a><h1>${esc(data.title)}</h1><p>${esc(data.source.version)} · ${esc(data.source.commit.slice(0, 7))} · ${esc(data.edgeSemantics)}</p><nav><label>主题 <select aria-label="选择工程主题"><option value="all">全部主题</option>${data.groups.map((g, n) => `<option value="${n}">${esc(g.label)}</option>`).join('')}</select></label><button data-zoom="in" aria-label="放大导图">＋</button><button data-zoom="out" aria-label="缩小导图">−</button><button data-zoom="fit">适应宽度</button><a href="engineering/architecture.canvas" download>下载 Canvas</a><a href="engineering/engineering-map.md" download>Mermaid 与源码索引</a></nav></header><div class="viewer" aria-label="源码工程思维导图"></div><footer>点击实现节点打开固定源码。Canvas 可在 Obsidian 编辑；图是导航，结论仍需沿源码验证。</footer><script type="application/json" id="map-data">${json}</script><script>
const data=JSON.parse(document.getElementById('map-data').textContent),viewer=document.querySelector('.viewer'),select=document.querySelector('select');let scale=1;
const escape=s=>String(s).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
function draw(){const groups=select.value==='all'?data.groups:[data.groups[Number(select.value)]];let y=20;const items=[],paths=[];for(const group of groups){const gy=y+(group.nodes.length*140-40)/2;items.push({x:390,y:gy-45,w:250,h:90,title:group.label,group:true});for(const node of group.nodes){items.push({x:770,y,w:470,h:100,title:node.label,subtitle:node.file.split('/').slice(-2).join('/')+':'+node.start,url:node.url});paths.push('<path d="M640 '+gy+' C700 '+gy+' 700 '+(y+50)+' 770 '+(y+50)+'"/>');y+=140;}paths.push({gy});y+=70;}const ry=y/2;let pathHtml='';for(const p of paths){if(typeof p==='string')pathHtml+=p;else pathHtml+='<path d="M290 '+ry+' C340 '+ry+' 340 '+p.gy+' 390 '+p.gy+'"/>';}items.unshift({x:10,y:ry-65,w:280,h:130,title:data.title,subtitle:data.source.version,root:true});viewer.innerHTML='<svg viewBox="0 0 1280 '+(y+20)+'" role="group" aria-label="'+escape(data.title)+'"><g fill="none" stroke="#b9b9bf" stroke-width="2">'+pathHtml+'</g>'+items.map(n=>'<g class="map-node">'+(n.url?'<a href="'+escape(n.url)+'" target="_blank" rel="noopener">':'')+'<rect x="'+n.x+'" y="'+n.y+'" width="'+n.w+'" height="'+n.h+'" rx="12" fill="'+(n.root?'#202024':n.group?'#fff1e7':'#fff')+'" stroke="#d0d0d4"/><text x="'+(n.x+20)+'" y="'+(n.y+38)+'" fill="'+(n.root?'#fff':'#29292d')+'" font-size="20" font-weight="600">'+escape(n.title)+'</text>'+(n.subtitle?'<text x="'+(n.x+20)+'" y="'+(n.y+69)+'" fill="'+(n.root?'#ccc':'#777')+'" font-size="14">'+escape(n.subtitle)+'</text>':'')+(n.url?'</a>':'')+'</g>').join('')+'</svg>';fit();}
function resize(){viewer.querySelector('svg').style.width=Math.round(1280*scale)+'px'}function fit(){scale=Math.min(1,(viewer.clientWidth-48)/1280);resize()}select.addEventListener('change',draw);document.querySelectorAll('[data-zoom]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.zoom==='fit')fit();else{scale=Math.min(2,Math.max(.2,scale*(b.dataset.zoom==='in'?1.2:1/1.2)));resize()}}));draw();
  </script></html>`;
  return { data, html, canvas: JSON.stringify(canvas, null, 2) + '\n', markdown };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const result = engineeringMap(root);
  if (process.argv.includes('--write')) {
    mkdirSync(resolve(root, 'docs'), { recursive: true });
    writeFileSync(resolve(root, 'engineering/architecture.canvas'), result.canvas);
    writeFileSync(resolve(root, 'docs/engineering-map.md'), result.markdown);
  }
  console.log(`${result.data.title}: ${result.data.groups.length} 个主题；源码链接与 Canvas 引用验证通过`);
}
