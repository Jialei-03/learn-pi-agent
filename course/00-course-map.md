---
motto: 先看清地图，再走进任何一个文件。
learn:
  - Coding Agent 的四层结构，以及 Pi 的各个包分别负责哪一层
  - 用户按下回车之后，请求经过哪些函数到达模型，结果又怎样回到屏幕和磁盘
  - Pi 刻意没做哪些功能，这门课怎样用扩展补上
  - 每一章的学法：Build、Read、Extend、Interview
prereq: 能读 TypeScript；用过任意一个 AI 编程工具
time: 25 分钟
build: 跑通课程环境
---

你用过 Claude Code、Cursor 或者 Codex，知道它们能读代码、改文件、跑命令。这门课要回答的问题是：**这些事情在代码里到底是怎么发生的？**

我们选 [Pi](https://github.com/earendil-works/pi) 作为解剖对象。它是一个开源（MIT）、生产级的 coding agent，架构和 Claude Code 属于同一类：一个模型、一组工具、一个循环，外加会话、上下文和扩展。它的代码量适中，分层清楚，而且作者刻意把内核做得很小——这让它特别适合拿来学。

整门课固定在 Pi **v1.5.0**（提交 `f9a2636`）。正文里每一段 Pi 源码都是构建网站时从这个提交里读出来的，行号会被自动校验，所以你看到的代码和仓库里的永远一致。

## 一个 Coding Agent 由什么组成

把任何一个 coding agent 拆开，都能看到四层。越往下越通用，越往上越接近“产品”。

<figure class="diagram">
<svg viewBox="0 0 760 470" role="img" aria-label="Pi 的四层结构">
  <defs>
    <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--signal)"/></marker>
  </defs>
  <g font-size="12.5">
    <!-- 层标签 -->
    <g fill="var(--muted)" font-size="12" font-weight="700" letter-spacing=".06em">
      <text x="16" y="52">界面</text><text x="16" y="152">产品</text><text x="16" y="282">循环</text><text x="16" y="392">模型</text>
    </g>
    <!-- 界面层 -->
    <rect x="70" y="22" width="540" height="56" rx="10" fill="var(--bg-soft)" stroke="none"/>
    <text x="596" y="40" fill="var(--muted)" font-size="11" class="mono" text-anchor="end">packages/tui · coding-agent/src/modes</text>
    <g fill="var(--bg)" stroke="var(--line-2)" stroke-width="1">
      <rect x="84" y="47" width="118" height="24" rx="6"/><rect x="212" y="47" width="118" height="24" rx="6"/><rect x="340" y="47" width="118" height="24" rx="6"/><rect x="468" y="47" width="128" height="24" rx="6"/>
    </g>
    <g fill="var(--ink)" text-anchor="middle"><text x="143" y="63">终端交互 TUI</text><text x="271" y="63">print / json</text><text x="399" y="63">RPC 模式</text><text x="532" y="63">TypeScript SDK</text></g>

    <!-- 产品层 -->
    <rect x="70" y="100" width="540" height="120" rx="10" fill="var(--bg-soft)" stroke="none"/>
    <text x="596" y="118" fill="var(--muted)" font-size="11" class="mono" text-anchor="end">packages/coding-agent/src/core</text>
    <rect x="84" y="128" width="512" height="34" rx="7" fill="var(--ink)"/>
    <text x="340" y="150" fill="var(--paper)" text-anchor="middle" font-weight="700">AgentSession：把下面所有东西组装起来，处理重试、压缩、持久化</text>
    <g fill="var(--bg)" stroke="var(--line-2)" stroke-width="1">
      <rect x="84" y="172" width="96" height="36" rx="6"/><rect x="188" y="172" width="96" height="36" rx="6"/><rect x="292" y="172" width="96" height="36" rx="6"/><rect x="396" y="172" width="96" height="36" rx="6"/><rect x="500" y="172" width="96" height="36" rx="6"/>
    </g>
    <g fill="var(--ink)" text-anchor="middle"><text x="132" y="194">工具</text><text x="236" y="194">上下文</text><text x="340" y="194">会话 JSONL</text><text x="444" y="194">压缩</text><text x="548" y="194">扩展 / MCP</text></g>

    <!-- 循环层 -->
    <rect x="70" y="244" width="540" height="72" rx="10" fill="var(--bg-soft)" stroke="none"/>
    <text x="596" y="262" fill="var(--muted)" font-size="11" class="mono" text-anchor="end">packages/agent（pi-agent-core）</text>
    <g fill="var(--bg)" stroke="var(--line-2)" stroke-width="1"><rect x="84" y="272" width="240" height="32" rx="6"/></g>
    <rect x="336" y="272" width="260" height="32" rx="6" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1.2"/>
    <g text-anchor="middle"><text x="204" y="292" fill="var(--ink)">Agent：状态、队列、取消、事件</text><text x="466" y="292" fill="var(--accent-ink)" font-weight="700">runLoop：模型 ⇄ 工具 的循环</text></g>

    <!-- 模型层 -->
    <rect x="70" y="340" width="540" height="72" rx="10" fill="var(--bg-soft)" stroke="none"/>
    <text x="596" y="358" fill="var(--muted)" font-size="11" class="mono" text-anchor="end">packages/ai（pi-ai）</text>
    <g fill="var(--bg)" stroke="var(--line-2)" stroke-width="1"><rect x="84" y="368" width="200" height="32" rx="6"/><rect x="296" y="368" width="300" height="32" rx="6"/></g>
    <g fill="var(--ink)" text-anchor="middle"><text x="184" y="388">统一的消息与事件格式</text><text x="446" y="388">Provider 适配：Anthropic / OpenAI / …</text></g>

    <!-- 外部 -->
    <rect x="300" y="432" width="160" height="28" rx="14" fill="var(--ink)"/>
    <text x="380" y="451" fill="var(--paper)" text-anchor="middle" font-weight="700">模型服务的 HTTP API</text>

    <!-- 旁路包 -->
    <text x="640" y="40" fill="var(--muted)" font-size="11" font-weight="700" letter-spacing=".06em">独立的包</text>
    <g fill="none" stroke="var(--line-2)" stroke-dasharray="3 3">
      <rect x="636" y="50" width="110" height="30" rx="6"/><rect x="636" y="88" width="110" height="30" rx="6"/><rect x="636" y="126" width="110" height="30" rx="6"/><rect x="636" y="164" width="110" height="30" rx="6"/><rect x="636" y="202" width="110" height="30" rx="6"/><rect x="636" y="240" width="110" height="30" rx="6"/>
    </g>
    <g fill="var(--ink-2)" text-anchor="middle" class="mono" font-size="11.5"><text x="691" y="69">mcp</text><text x="691" y="107">codemode</text><text x="691" y="145">schema</text><text x="691" y="183">durable</text><text x="691" y="221">telemetry</text><text x="691" y="259">evals</text></g>

    <!-- 请求路径 -->
    <g stroke="var(--accent)" stroke-width="1.5" fill="none" marker-end="url(#arr)">
      <path d="M143 71 V128"/><path d="M200 162 V272"/><path d="M466 304 V368"/><path d="M380 400 V432"/>
    </g>
    <g fill="var(--signal)" font-weight="700" font-size="12"><text x="150" y="93">① prompt</text><text x="207" y="236">② agent.prompt</text><text x="473" y="332">③ streamSimple</text><text x="388" y="424">④ HTTP</text></g>
  </g>
</svg>
<figcaption>Pi 的四层结构。橙色箭头是一次请求向下走的路径；结果以事件的形式原路返回。</figcaption>
</figure>

| 层 | 负责什么 | Pi 里在哪 | 不知道什么 |
| --- | --- | --- | --- |
| 模型层 | 把各家 API 的差异抹平：统一的消息格式、流式事件、停止原因、用量和费用 | `packages/ai` | 不知道循环、工具怎么执行 |
| 循环层 | 问模型 → 执行工具 → 结果放回 → 再问，以及什么时候停 | `packages/agent` | 不知道有哪些具体工具，不知道会话存在哪 |
| 产品层 | 具体的工具（read、edit、bash……）、上下文装配、会话存储、压缩、扩展 | `packages/coding-agent/src/core` | 不知道界面长什么样 |
| 界面层 | 终端交互、一次性命令、RPC、SDK | `packages/tui`、`coding-agent/src/modes` | —— |

最右列是这张表里最重要的一列。**每一层都只依赖它下面的层，并且刻意不知道上面的事。** 循环层不知道请求最后发给了 Anthropic 还是 DeepSeek，所以换模型不用动循环；模型层不知道工具怎么执行，所以同一套适配器可以给任何 agent 用。你在面试里被问到“怎么设计一个支持多模型的 agent”，答案的骨架就是这张表。

## 一次回车经过哪些代码

在 Pi 的终端里输入“README 讲了什么？”并按下回车。下面是这句话走过的路径，每一步都链接到固定版本的源码。

1. **产品层接住输入。** [`AgentSession.prompt()`](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/coding-agent/src/core/agent-session.ts#L2113) 先检查这是不是 `/命令`，再展开提示模板，然后把文字包装成一条 user 消息，交给循环层的 [`agent.prompt()`](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/coding-agent/src/core/agent-session.ts#L1920)。
2. **循环层准备一次运行。** [`Agent.prompt()`](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/agent/src/agent.ts#L382) 创建取消信号、标记“正在运行”，再调用 [`runAgentLoop()`](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/agent/src/agent-loop.ts#L111)。
3. **循环开始转。** [`runLoop()`](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/agent/src/agent-loop.ts#L172) 把上下文交给 [`streamAssistantResponse()`](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/agent/src/agent-loop.ts#L390)，后者调用模型层的流式函数。
4. **模型层翻译并发送。** 对 Anthropic 模型，[`anthropic-messages.ts`](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/ai/src/api/anthropic-messages.ts#L1348) 把统一格式的消息翻译成 Anthropic 的请求体，发出 HTTP 请求，再把返回的 SSE 流组装回统一格式。
5. **模型要求读文件。** 回复里有一个 `read` 工具调用，循环通过 [`executeToolCalls()`](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/agent/src/agent-loop.ts#L518) 执行它，把结果追加到上下文，再回到第 3 步。
6. **结果原路返回。** 循环的每一步都发出事件（`message_start`、`tool_execution_end`、`turn_end`……）。`AgentSession` 订阅这些事件：界面据此实时刷新，消息完成时[写进会话文件](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/coding-agent/src/core/agent-session.ts#L1181)。

第 2 步进入循环层的入口很短，值得先看一眼：

@pi packages/agent/src/agent-loop.ts#runAgentLoop

它做的事情只有三件：把新消息拼到已有上下文后面，发出“开始”事件，然后把一切交给 `runLoop`。注意它不保存任何东西——保存是第 6 步产品层订阅事件时做的。**循环只负责“转”，不负责“记”。**

::: insight 贯穿整门课的三个设计决定
1. **分层。** 每层只依赖下层，所以换模型、换界面、换存储都不用碰循环。
2. **一切都是事件。** 循环不直接画界面、不直接写文件，它只发事件。界面、会话存储、扩展、测试都是事件的订阅者。
3. **内核小，能力靠扩展。** 下一节细说。
:::

## Pi 刻意没做的事

Pi 的 README 第一段就写明了立场：它“提供强大的默认能力，但跳过子 Agent 和 Plan Mode 这类功能”，想要就自己构建，或者安装别人做好的包。

这对学习者是好事。和 Claude Code、Codex CLI、Gemini CLI、opencode 对照之后，Pi 的能力可以分成三类，课程也分别处理：

| 类别 | 机制 | 课程怎么讲 |
| --- | --- | --- |
| **内核自带** | Agent Loop、工具、上下文文件（`AGENTS.md` / `CLAUDE.md`）、Skills、提示模板、会话树、Compaction、MCP、扩展事件、print / json / RPC / SDK、项目信任 | 先手写最小版本，再读 Pi 源码 |
| **官方给了扩展示例** | 子 Agent、Plan Mode、Todo、权限拦截、Git Checkpoint | 读示例，讲清楚 Pi 为什么不把它放进内核 |
| **完全没有** | 权限规则与模式、系统级沙箱、长期记忆、后台命令、Web 抓取、“做完才停”的目标循环、兼容 Claude Code 协议的 Hooks | **我们自己写扩展补上**，标着“扩展”的章节就是这些 |

“完全没有”那一行，正是面试里最常被追问的部分：权限怎么设计、沙箱和审批有什么区别、长期记忆存什么不存什么。自己实现一遍，比读任何文档都记得牢。

::: compare 这些功能在其他 Agent 里叫什么
同一个机制在不同产品里名字不同，课程会统一说明。比如“工具执行前拦截”在 Claude Code 里是 `PreToolUse` hook，在 Gemini CLI 里是 `BeforeTool`，在 opencode 里是 `tool.execute.before` 插件钩子，在 Pi 里是扩展事件 `tool_call`。Claude Code 的部分只引用 [官方文档](https://code.claude.com/docs)。
:::

## 这门课怎么学

每一章都围绕一个机制，按同样的顺序展开：

1. **一个现象。** 先看一个具体问题：模型为什么读不到你的文件？流被掐断时会发生什么？
2. **Build：亲手实现。** 在 `mox`（我们的 agent）里用几十行代码实现最小版本。带橙色 <span class="src-badge mox">mox</span> 标记的代码在本仓库里，可以直接运行。
3. **找到它的边界。** 构造几个最小版本处理不了的情形——生产级的实现为什么要多做那些事，答案就在这里。
4. **Read：看生产代码怎么做。** 带黑色 <span class="src-badge pi">Pi v1.5.0</span> 标记的代码来自 Pi 的固定提交，点文件名就能跳到 GitHub 上的对应行。
5. **Extend：补齐能力。** 部分章节会给 Pi 写一个扩展。
6. **Interview：讲得出取舍。** 章末的面试题汇总在[面试题库](../interview.html)。

正文里的终端输出都是构建网站时**真正运行**实验得到的，不是手写的。你在本地运行同一条命令，应该看到同样的结果。

### 准备环境

需要 Node.js 22.19 或更新版本（课程代码是 TypeScript，Node 可以直接运行，不需要编译）。

```bash
git clone https://github.com/Jialei-03/learn-pi-agent.git
cd learn-pi-agent && npm install
```

`npm install` 只为两件事安装依赖：实验里用到的 Pi 包（版本固定为 1.5.0），以及生成网站用的 Markdown 和代码高亮工具。`mox` 本身没有任何依赖。

建议把 Pi 源码也克隆到旁边，读代码时对照着看：

```bash
git clone --branch v1.5.0 https://github.com/earendil-works/pi.git ../pi-v1.5.0
```

验证环境：下面这个实验把同一段录制好的网络数据交给 mox 和 Pi 各自的两个适配器，四个实现应该得出一样的结果（第 2 章会详细讲它）。

@lab node labs/ch02/replay.ts

最后一行显示“是”，环境就没问题。所有实验默认使用脚本模型，**不需要 API Key，也不会产生费用**。想接真实模型时，第 1 章会告诉你怎么配置。

### 读源码的方法

- **先看签名和调用者，再看函数体。** 一个函数被谁调用、返回什么，比它内部的细节重要得多。
- **跟着一个具体输入走。** 每章都会给一个具体的场景，比如“读一个不存在的文件”。带着这个场景读代码，比漫无目的地读快得多。
- **注意“不做什么”。** 好的代码里，一个函数刻意不处理的事情往往和它处理的事情一样有信息量。

## 面试题

先自己回答，再展开对照要点。

::: interview 说说一个 coding agent 的整体架构
按层回答，每层说清楚“负责什么”和“刻意不知道什么”：

- **模型层**：统一消息格式和流式事件，抹平各家 API 差异（工具结果的表示、系统提示的位置、停止原因）。
- **循环层**：模型 ⇄ 工具 的循环、停止条件、取消、运行中插入的消息。它不知道具体工具和存储。
- **产品层**：具体工具、上下文装配（系统提示、项目说明文件、Skills）、会话持久化、上下文压缩、扩展机制。
- **界面层**：终端、一次性命令、RPC、SDK，全部订阅同一套事件。

加分点：说明为什么要这样分层（换模型不动循环、同一个循环可以服务多种界面），以及“一切都是事件”让持久化、界面和扩展彼此解耦。
:::

::: interview Pi 和 Claude Code 在设计取向上有什么不同？
两者都是“模型 + 工具 + 循环”的同一类架构，差别在于**默认内置多少**：

- Claude Code 内置了权限模式和规则、子 Agent、Plan Mode、Hooks、长期记忆、检查点等大量功能，开箱即用。
- Pi 刻意保持内核很小，README 明确说跳过子 Agent 和 Plan Mode；这些能力通过 TypeScript 扩展实现，官方提供了示例。
- 取舍：内置功能一致、可管控、适合团队统一配置；小内核加扩展更灵活，但每个扩展都运行在 Agent 进程内，扩展本身就是信任边界。

回答时避免说“谁更好”，而是说清楚各自适合的场景。
:::
