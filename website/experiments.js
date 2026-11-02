// Diagrams show selected fields from Pi's results. Writing data through textContent
// also keeps the editable README plain text in every stage of the diagram.
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Each arrow labels the value crossing this boundary at the selected step.
function readMap(index, scenario) {
  const omitted = scenario === 'length' && (index === 2 || index === 3);
  const flows = [
    ['←', '·', '请求上下文', ''],
    ['→', '·', 'toolCall', ''],
    ['·', omitted ? '×' : '→', '', omitted ? '跳过' : '参数'],
    ['·', omitted ? '×' : '←', '', omitted ? '合成错误' : '结果'],
    ['←', '·', '含工具结果', ''],
  ];
  const [left, right, leftValue, rightValue] = flows[index];
  const map = element('div', 'mechanism-map read-map');
  const nodes = ['模型', 'Agent Loop', 'read'];
  map.setAttribute('aria-label', '模型、循环和工具之间的数据流');
  nodes.forEach((name, i) => {
    const active = i === 1 || (i === 0 && left !== '·') || (i === 2 && right !== '·' && !omitted);
    map.append(element('span', 'map-object' + (active ? ' lit' : ''), name));
    if (i < 2) {
      const edge = element('span', 'map-edge');
      edge.append(element('b', '', i === 0 ? left : right), element('small', '', i === 0 ? leftValue : rightValue));
      map.append(edge);
    }
  });
  return map;
}

function projectionMap(index) {
  const map = element('div', 'mechanism-map history-map');
  const groups = [
    [['活动路径', 'a b c d e']],
    [['旧历史', 'a b'], ['轮次前缀', 'c'], ['保留原文', 'd e']],
    [['原记录', 'a b c d e'], ['追加', 'x']],
    [['摘要', 'x'], ['保留原文', 'd e']],
    [['旧叶 e 的路径', 'a b c d e']],
  ];
  for (const [label, ids] of groups[index]) {
    const group = element('div', 'history-group');
    const row = element('div', 'history-ids');
    ids.split(' ').forEach(id => row.append(element('b', id === 'x' ? 'summary-id' : '', id)));
    group.append(row, element('small', '', label));
    map.append(group);
  }
  return map;
}

function makeFigure(marker, caption, title, description, labels, map) {
  const figure = element('figure', 'experiment');
  const heading = element('figcaption', 'experiment-caption');
  heading.append(element('small', 'figure-no', caption), element('strong', '', title));
  figure.append(heading, element('p', 'experiment-description', description));
  const settings = element('div', 'experiment-settings');
  const nav = element('div', 'frame-track');
  nav.setAttribute('role', 'group');
  nav.setAttribute('aria-label', '选择图解步骤');
  const stage = element('div', 'frame-body');
  stage.setAttribute('aria-live', 'polite');
  const footer = element('div', 'frame-footer');
  const prev = element('button', 'frame-button', '← 上一步');
  const next = element('button', 'frame-button', '下一步 →');
  const counter = element('span', 'frame-counter');
  footer.append(prev, counter, next);
  figure.append(settings, nav, stage, footer);
  marker.parentElement.before(figure);
  let frames = [], current = 0;
  const buttons = labels.map((label, i) => {
    const button = element('button', 'frame-node');
    button.append(element('span', 'node-number', String(i + 1)), element('span', '', label));
    button.addEventListener('click', () => show(i));
    nav.append(button);
    return button;
  });
  function show(index) {
    if (!frames[index]) return;
    current = index;
    const frame = frames[index];
    buttons.forEach((node, i) => node.setAttribute('aria-pressed', String(i === index)));
    prev.disabled = index === 0;
    next.disabled = index === frames.length - 1;
    counter.textContent = (index + 1) + ' / ' + frames.length;
    const value = element('pre', 'frame-value', frame.value);
    const parts = [map(index), element('span', 'frame-source', frame.source), element('strong', 'frame-title', frame.title),
      element('p', '', frame.explain), value];
    if (frame.data !== undefined) {
      const details = element('details', 'frame-details');
      details.append(element('summary', '', '查看数据字段'), element('pre', '', JSON.stringify(frame.data, null, 2)));
      parts.push(details);
    }
    stage.replaceChildren(...parts);
  }
  prev.onclick = () => show(current - 1);
  next.onclick = () => show(current + 1);
  return { figure, settings, stage, setFrames(data, index = 0) { frames = data; show(index); } };
}

async function mountRead(marker) {
  marker.textContent = '查看完整程序与本地运行方式 ↗';
  const lab = makeFigure(marker, '图 1.1 · 可运行实验', '跟随一次 README 读取',
    '切换输入条件，用下方五个步骤查看这一次运行的数据。', ['首次请求', '模型回复', '执行工具', '回填结果', '再次请求'], index => readMap(index, select.value));
  const label = element('label', 'case-picker', '输入条件');
  const select = element('select');
  for (const [value, text] of [['success','正常读取'], ['missing','文件不存在'], ['length','模型输出被截断']]) {
    const option = element('option', '', text);
    option.value = value;
    select.append(option);
  }
  label.append(select);
  const edit = element('details', 'edit-fixture');
  const summary = element('summary', '', '编辑 README.md');
  const textarea = element('textarea');
  textarea.rows = 4;
  textarea.maxLength = 8000;
  textarea.setAttribute('aria-label', '示例文件 README.md 的内容');
  textarea.value = '# 木星笔记\n\n一个将 Markdown 笔记整理成索引的命令行工具。\n';
  const submit = element('button', 'apply-fixture', '使用这份内容运行');
  edit.append(summary, textarea, submit);
  lab.settings.append(label, edit);
  lab.stage.textContent = '正在准备本地示例…';
  let sequence = 0;
  async function run(index = 0) {
    const ticket = ++sequence;
    const scenario = select.value;
    try {
      const { runBrowserExample } = await import('./read-loop.mjs');
      const { requests, messages, events, executions } = await runBrowserExample(textarea.value, scenario);
      if (!lab.figure.isConnected || ticket !== sequence) return;
      const call = messages.find(m => m.role === 'assistant');
      const result = messages.find(m => m.role === 'toolResult');
      const last = messages.at(-1);
      lab.setFrames([
        { source: 'streamFn · 第 1 次调用', title: '模型先收到问题与工具声明',
          explain: '当前可用工具是 read。用户尚未提供文件正文，工具声明由循环放入系统消息。',
          value: requests[0].map(m => m.role).join(' → '), data: requests[0] },
        { source: 'AssistantMessage.content', title: '模型给出要调用的工具',
          explain: 'read-1 关联这次请求与稍后的结果。停止原因会影响运行时接下来采取的动作。',
          value: 'read(' + JSON.stringify(call.content[0].arguments) + ')\nstopReason = ' + call.stopReason, data: call },
        { source: 'read.execute · 函数入口记录', title: executions.length ? '运行时进入了工具函数' : '运行时跳过了工具函数',
          explain: scenario === 'length' ? '整条回复因长度上限结束。即使这份参数看起来完整，Pi 也把这一批调用标为失败。' :
            scenario === 'missing' ? '参数通过校验。工具在虚拟目录中查找 absent.md 时抛出错误，循环将它转换成错误结果。' :
            '参数通过校验，浏览器工具读取上方可编辑的文本。本地命令在这个位置调用内置 read，读取磁盘。',
          value: '进入 execute 次数 = ' + executions.length, data: executions },
        { source: 'ToolResultMessage', title: '用调用编号将结果写回',
          explain: '下一轮模型可以区分失败和文件正文。这里显示本次循环实际生成的消息。',
          value: 'toolCallId = ' + result.toolCallId + '   isError = ' + result.isError + '\n' + result.content[0].text, data: result },
        { source: 'streamFn · 第 2 次调用', title: '模型现在能利用工具结果',
          explain: '第二轮的脚本从工具结果中选出说明段落，或返回失败提示。下方字段列出这次运行的事件顺序。',
          value: requests[1].map(m => m.role).join(' → ') + '\n\n' + last.content[0].text, data: { events, last } },
      ], index);
    } catch (error) { lab.stage.textContent = '运行失败。' + error.message; }
  }
  select.onchange = () => run(2);
  submit.onclick = () => { edit.open = false; run(4); summary.focus(); };
  await run();
}

async function mountProjection(marker) {
  marker.textContent = '查看生成这份回放的程序 ↗';
  const lab = makeFigure(marker, '图 6.1 · 源码运行回放', '一条过长的工具结果如何改变切点',
    '下图重放 Pi 在一组固定输入上的计算。工具结果有 8,000 个字符，摘要文字由示例给定。', ['原始记录', '选择切点', '追加摘要', '恢复上下文', '回到旧叶'], projectionMap);
  try {
    const response = await fetch('./projection.json');
    if (!response.ok) throw new Error('回放数据无法加载');
    const d = await response.json();
    const roles = data => data.join(' → ');
    lab.setFrames([
      { source: 'buildSessionContext · leaf e', title: '从当前叶节点沿父指针读出五条消息',
        explain: 'a、b 属于旧问答；c 发起本轮读取，d 请求工具，e 保存结果。',
        value: roles(d.before), data: d.records },
      { source: 'findCutPoint · keepRecentTokens = ' + d.keepRecentTokens, title: '最后一条结果本身就超过了保留预算',
        explain: '工具结果不能单独作为起点。Pi 找到最近的合法切点 d，同时识别出当前轮从 c 开始。',
        value: 'a  b   |   c   |   d  e\n旧历史     本轮前缀    保留原文', data: d.cut },
      { source: 'CompactionEntry · id x', title: '追加一条带保留边界的检查点',
        explain: '它的父节点是 e，但 firstKeptEntryId 指向更早的 d。这两个指针分别说明历史关系与保留范围。',
        value: 'parentId = ' + d.checkpoint.parentId + '\nfirstKeptEntryId = ' + d.checkpoint.firstKeptEntryId, data: d.checkpoint },
      { source: 'buildSessionContext · leaf x', title: '用摘要和保留尾部构造消息',
        explain: '恢复时先出现压缩摘要，然后是原始工具请求及其结果。这是 Session 层投影，后面还有向 Provider 的消息转换。',
        value: roles(d.after), data: d.after },
      { source: 'buildSessionContext · leaf e', title: '切回旧叶，五条消息仍可读到',
        explain: '追加检查点保留了之前的记录。叶节点决定本次投影选择哪条历史。',
        value: roles(d.oldLeaf), data: d.oldLeaf },
    ]);
  } catch (error) { lab.stage.textContent = error.message; }
}

async function mountBatch(marker) {
  marker.textContent = '查看批次实验的完整程序 ↗';
  let trace;
  const lab = makeFigure(marker, '图 3.1 · 可运行实验', '两个工具返回后，还会请求模型吗',
    'A 始终要求终止。改变 B 的结果和 follow-up 队列，观察实际发出的请求次数。',
    ['提出调用', '工具返回', '批次决定', '检查队列', '实际请求'], index => {
      const map = element('div', 'mechanism-map history-map');
      const rows = [['调用 A', '调用 B'], trace.reports.map(r => r.id + ' · ' + r.terminate),
        [trace.reports.every(r => r.terminate) ? '批次要求终止' : '工具驱动下一轮'],
        [select.value === 'followUp' ? '追加 user 消息' : '无后续用户输入'],
        trace.requests.map((_, i) => '请求 ' + (i + 1))];
      rows[index].forEach(text => map.append(element('span','map-object lit',text)));
      return map;
    });
  const label = element('label', 'case-picker', '批次情形');
  const select = element('select');
  for (const [value, title] of [['mixed','只有 A 要求终止'],['all','A 和 B 都要求终止'],['followUp','全部终止，有后续输入']]) {
    const option = element('option', '', title); option.value = value; select.append(option);
  }
  label.append(select); lab.settings.append(label);
  let sequence = 0;
  async function run(step = 0) {
    const ticket = ++sequence;
    const mode = select.value;
    try {
      const { runBatch } = await import('./read-loop.mjs');
      const result = await runBatch(mode);
      if (ticket !== sequence || !lab.figure.isConnected) return;
      trace = result;
      const all = trace.reports.every(r => r.terminate);
      lab.setFrames([
        { source: 'AssistantMessage.content', title: '一次回复提出两次查询', explain: '两个调用指向同一个 lookup 工具，参数和调用编号各异。', value: 'lookup({slot: "A"})   +   lookup({slot: "B"})' },
        { source: 'AgentToolResult.terminate', title: '分别读取两个执行结果', explain: '这两个值记录在实验工具的返回边界。本例没有钩子继续修改结果。', value: trace.reports.map(r => r.id + ' → ' + r.terminate).join('   '), data: trace.reports },
        { source: 'shouldTerminateToolBatch', title: all ? '这个非空批次的全部结果都要求终止' : 'B 的结果仍要求自然继续', explain: 'Pi 对最后的工具结果做 every 判断。这里的值只决定还需不需要因为工具而继续。', value: 'hasMoreToolCalls = ' + !all },
        { source: 'getFollowUpMessages', title: mode === 'followUp' ? '外层循环取到一条后续输入' : '没有排队的后续输入', explain: mode === 'followUp' ? '即使批次要求终止，外层循环取到 user 消息后仍会再请求模型。' : mode === 'mixed' ? '工具驱动的下一轮先运行。只有内层循环结束时才轮到外层检查 follow-up。' : '内层循环已经结束，后续队列为空，本例也没有显式继续的决定。', value: mode === 'followUp' ? 'user · 再说明一下 B' : 'follow-up 队列为空' },
        { source: 'streamFn · 实际调用记录', title: '实际发出了 ' + trace.requests.length + ' 次模型请求', explain: '若有第二次请求，末尾角色能区分工具驱动的继续和新用户输入。', value: trace.requests.map((r,i) => (i+1) + ' · ' + r.join(' → ')).join('\n'), data: trace.events },
      ], step);
    } catch (error) { lab.stage.textContent = error.message; }
  }
  select.onchange = () => run(4);
  await run();
}

export function mountExperiments(article) {
  for (const node of article.querySelectorAll('a')) {
    if (node.textContent === '运行 README 实验') mountRead(node);
    if (node.textContent === '运行批次停止实验') mountBatch(node);
    if (node.textContent === '逐步查看会话投影') mountProjection(node);
  }
}
