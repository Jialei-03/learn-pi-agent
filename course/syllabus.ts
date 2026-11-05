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
      { n: 0, slug: '00-course-map', title: '课程地图：一个 Coding Agent 由什么组成', summary: 'Pi 的分层、一次请求的全程，以及这门课的学法：读懂 Pi，每章末尾搭一块 mox。', status: 'ready' },
    ],
  },
  {
    id: 'p1', title: '内核', subtitle: '一个能干活的 Agent',
    chapters: [
      { n: 1, slug: '01-from-api-to-agent', title: '从一次 API 调用到 Agent', summary: '看懂“模型决定，程序执行”，Pi 把它分成了哪几层；实战：搭出 mox 的第一个循环。', status: 'ready' },
      { n: 2, slug: '02-model-protocol', title: '模型协议：消息、流式与 Provider 适配', summary: 'Pi 怎样把各家 API 翻译成一种内部格式，流式参数怎样拼回来；实战：mox 的模型适配。', status: 'ready' },
      { n: 3, slug: '03-agent-loop', title: 'Agent Loop：停止、截断与插话', summary: '让一个朴素循环坏四次，读 Pi 的 runLoop 怎样防住；实战：给 mox 的循环加上保护。', status: 'ready' },
      { n: 4, slug: '04-tool-system', title: '工具系统：契约、校验、拦截与并行', summary: 'Pi 的六道关：参数校验、before/after 钩子、并行与串行、批次终止；实战：mox 的工具接口。', status: 'ready' },
      { n: 5, slug: '05-coding-tools', title: 'Coding 工具：read、edit、bash 的设计细节', summary: '读 Pi 的 read、edit、bash：为什么 edit 用字符串替换、输出怎样截断、命令怎样超时；实战：给 mox 写同样的七个工具。', status: 'ready' },
    ],
  },
  {
    id: 'p2', title: '上下文', subtitle: '让模型看到对的东西',
    chapters: [
      { n: 6, slug: '06-context-assembly', title: '上下文装配：System Prompt、AGENTS.md 与 Token 预算', summary: 'Pi 的模型这一轮到底看到了什么，以及为什么前缀要稳定；实战：mox 的系统提示。', status: 'ready' },
      { n: 7, slug: '07-sessions', title: '会话：JSONL 树、分支与恢复', summary: 'Pi 把对话存成一棵树，任意回退、分叉、续跑；实战：mox 的平铺会话。', status: 'ready' },
      { n: 8, slug: '08-compaction', title: 'Compaction：在有限窗口里继续工作', summary: 'Pi 的切点怎么选，为什么不能拆开工具调用与结果；实战：mox 的压缩。', status: 'ready' },
    ],
  },
  {
    id: 'p3', title: '扩展', subtitle: '把 Agent 变成平台',
    chapters: [
      { n: 9, slug: '09-extensions', title: '扩展系统：事件、注册与信任', summary: 'Pi 的四十多种事件、注册与信任；实战：给 mox 做一个扩展系统和第一个扩展 web_fetch。', status: 'ready', extend: true },
      { n: 10, slug: '10-memory', title: '长期记忆：跨会话的知识', summary: 'Pi 没有内置——用扩展写一个会自己记笔记的记忆系统，再移植到 mox。', status: 'ready', extend: true },
      { n: 11, slug: '11-skills', title: 'Skills 与 Prompt Templates：按需加载的能力', summary: '渐进式披露：Pi 只给目录，需要时才读全文；实战：mox 的 Skills。', status: 'ready' },
      { n: 12, slug: '12-mcp', title: 'MCP：把外部工具接进循环', summary: '协议握手、传输方式、工具映射；实战：给 mox 写一个五十多行的 MCP 客户端。', status: 'ready' },
      { n: 13, slug: '13-hooks', title: 'Hooks：用外部命令拦截与改写', summary: '写一个兼容 Claude Code hooks 协议的 Pi 扩展，再移植到 mox。', status: 'ready', extend: true },
    ],
  },
  {
    id: 'p4', title: '控制与安全', subtitle: '谁来决定能做什么',
    chapters: [
      { n: 14, slug: '14-permissions', title: '权限：allow、ask 与 deny', summary: 'Pi 默认不审批——写一个规则式权限扩展；实战：mox 的逐次确认和权限扩展。', status: 'ready', extend: true },
      { n: 15, slug: '15-sandbox', title: '执行环境与沙箱：审批不是隔离', summary: '用系统沙箱包住 Pi 的 bash 工具，再读 codemode 与远程执行；实战：mox 的沙箱扩展。', status: 'ready', extend: true },
      { n: 16, slug: '16-plan-todo-checkpoint', title: 'Plan Mode、Todo 与 Checkpoint', summary: '先想后做、任务清单、改坏了能回退：Pi 上的三个扩展，再移植到 mox。', status: 'ready', extend: true },
    ],
  },
  {
    id: 'p5', title: '多 Agent 与长任务', subtitle: '一个循环不够的时候',
    chapters: [
      { n: 17, slug: '17-subagents', title: 'Subagent：上下文隔离与并行委派', summary: '子 Agent 只拿到任务说明、只交回结论：用 token 换主对话的上下文；实战：mox 的 task 工具。', status: 'ready', extend: true },
      { n: 18, slug: '18-long-running', title: '长任务：后台进程、目标循环与 Durable', summary: '后台命令、“做完才停”的目标循环，以及崩溃后从哪里继续；实战：给 mox 加上它们。', status: 'ready', extend: true },
    ],
  },
  {
    id: 'p6', title: '工程化', subtitle: '把 Agent 交付出去',
    chapters: [
      { n: 19, slug: '19-sdk-rpc', title: '嵌入你的应用：SDK、RPC 与事件流', summary: 'Pi 的 SDK、打印模式与 RPC：同一个 Agent，终端、网页和服务端怎么用；实战：mox 的库用法和最小 RPC。', status: 'ready' },
      { n: 20, slug: '20-evals', title: '可观测与评测：证明 Agent 变好了', summary: '轨迹、指标与对照实验，而不是“感觉更聪明了”；实战：给 mox 做一次评测。', status: 'ready' },
      { n: 21, slug: '21-capstone', title: '毕业：Pi 全貌、你的 mox 与面试题库', summary: '回顾 Pi 的全貌，把一路搭出来的 mox 组装起来，再过一遍面试题。', status: 'ready' },
    ],
  },
];

export const chapters = parts.flatMap(p => p.chapters.map(c => ({ ...c, part: p })));
