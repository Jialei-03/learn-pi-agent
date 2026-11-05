// 课程目录：网站导航、首页路线图和章节编号都来自这里。
// status: 'ready' 表示正文已完成；'planned' 会在路线图上显示为“编写中”。

export const PI = {
  version: 'v1.5.0',
  commit: 'f9a26365568127461c47a07a37dcb42c140a3ac5',
  repo: 'https://github.com/earendil-works/pi',
};

export interface ChapterInfo { n: number; slug: string; title: string; summary: string; status: 'ready' | 'planned'; extend?: boolean }
export interface PartInfo { id: string; title: string; subtitle: string; chapters: ChapterInfo[] }

export const parts: PartInfo[] = [
  {
    id: 'p0', title: '开始之前', subtitle: '地图与工具',
    chapters: [
      { n: 0, slug: '00-course-map', title: '课程地图：一个 Coding Agent 由什么组成', summary: 'Pi 的分层、一次请求的全程，以及这门课的学法。', status: 'ready' },
    ],
  },
  {
    id: 'p1', title: '内核', subtitle: '一个能干活的 Agent',
    chapters: [
      { n: 1, slug: '01-from-api-to-agent', title: '从一次 API 调用到 Agent', summary: '读懂 mox 里约一百七十行的模型、循环和工具，看懂“模型决定，程序执行”。', status: 'ready' },
      { n: 2, slug: '02-model-protocol', title: '模型协议：消息、流式与 Provider 适配', summary: 'mox 只说 OpenAI 一种方言，Pi 会说所有方言；流式参数怎样拼回来。', status: 'ready' },
      { n: 3, slug: '03-agent-loop', title: 'Agent Loop：停止、截断与插话', summary: '让一个朴素循环坏四次，看 mox 的 runLoop 怎样修好，再对照 Pi。', status: 'ready' },
      { n: 4, slug: '04-tool-system', title: '工具系统：契约、校验、拦截与并行', summary: '参数校验、before/after 钩子、并行与串行、批次终止。', status: 'ready' },
      { n: 5, slug: '05-coding-tools', title: 'Coding 工具：read、edit、bash 的设计细节', summary: '和 Pi 同名同参数的七个工具：为什么 edit 用字符串替换、输出怎样截断、命令怎样超时。', status: 'ready' },
    ],
  },
  {
    id: 'p2', title: '上下文', subtitle: '让模型看到对的东西',
    chapters: [
      { n: 6, slug: '06-context-assembly', title: '上下文装配：System Prompt、AGENTS.md 与 Token 预算', summary: '模型这一轮到底看到了什么，以及为什么前缀要稳定。', status: 'ready' },
      { n: 7, slug: '07-sessions', title: '会话：JSONL、分支与恢复', summary: 'mox 把对话平铺成一行一条，Pi 存成一棵树；崩溃之后怎样续跑。', status: 'ready' },
      { n: 8, slug: '08-compaction', title: 'Compaction：在有限窗口里继续工作', summary: '切点怎么选，为什么不能拆开工具调用与结果。', status: 'ready' },
    ],
  },
  {
    id: 'p3', title: '扩展', subtitle: '把 Agent 变成平台',
    chapters: [
      { n: 9, slug: '09-extensions', title: '扩展系统：事件、注册与信任', summary: 'mox 的五个接口对 Pi 的四十多种事件；第一个扩展：web_fetch。', status: 'ready', extend: true },
      { n: 10, slug: '10-memory', title: '长期记忆：跨会话的知识', summary: 'mox 和 Pi 都没有内置——用扩展写一个会自己记笔记的记忆系统。', status: 'ready', extend: true },
      { n: 11, slug: '11-skills', title: 'Skills 与 Prompt Templates：按需加载的能力', summary: '渐进式披露：只给目录，需要时才读全文。', status: 'ready' },
      { n: 12, slug: '12-mcp', title: 'MCP：把外部工具接进循环', summary: '协议握手、传输方式、工具映射：读 mox 五十多行的 MCP 客户端。', status: 'ready' },
      { n: 13, slug: '13-hooks', title: 'Hooks：用外部命令拦截与改写', summary: '写一个兼容 Claude Code hooks 协议的扩展。', status: 'ready', extend: true },
    ],
  },
  {
    id: 'p4', title: '控制与安全', subtitle: '谁来决定能做什么',
    chapters: [
      { n: 14, slug: '14-permissions', title: '权限：allow、ask 与 deny', summary: 'mox 内置最简单的逐次确认，Pi 默认不审批——再写一个规则式权限扩展。', status: 'ready', extend: true },
      { n: 15, slug: '15-sandbox', title: '执行环境与沙箱：审批不是隔离', summary: '用系统沙箱包住 bash 工具，再读 codemode 与远程执行。', status: 'ready', extend: true },
      { n: 16, slug: '16-plan-todo-checkpoint', title: 'Plan Mode、Todo 与 Checkpoint', summary: '先想后做、任务清单、改坏了能回退。', status: 'ready', extend: true },
    ],
  },
  {
    id: 'p5', title: '多 Agent 与长任务', subtitle: '一个循环不够的时候',
    chapters: [
      { n: 17, slug: '17-subagents', title: 'Subagent：上下文隔离与并行委派', summary: '子 Agent 只拿到任务说明、只交回结论：用 token 换主对话的上下文。', status: 'ready', extend: true },
      { n: 18, slug: '18-long-running', title: '长任务：后台进程、目标循环与 Durable', summary: '后台命令、“做完才停”的目标循环，以及崩溃后从哪里继续。', status: 'ready', extend: true },
    ],
  },
  {
    id: 'p6', title: '工程化', subtitle: '把 Agent 交付出去',
    chapters: [
      { n: 19, slug: '19-sdk-rpc', title: '嵌入你的应用：SDK、RPC 与事件流', summary: '同一个 Agent，终端、网页和服务端怎么用。', status: 'ready' },
      { n: 20, slug: '20-evals', title: '可观测与评测：证明 Agent 变好了', summary: '轨迹、指标与对照实验，而不是“感觉更聪明了”。', status: 'ready' },
      { n: 21, slug: '21-capstone', title: '毕业：mox 全貌与面试题库', summary: '六百多行的 mox 从头到尾走一遍，再过一遍面试题。', status: 'ready' },
    ],
  },
];

export const chapters = parts.flatMap(p => p.chapters.map(c => ({ ...c, part: p })));
