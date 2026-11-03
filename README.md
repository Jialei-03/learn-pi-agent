# Learn Pi Agent

**从零造一个 Coding Agent，再读懂一个生产级的。**

每一章拆开 Coding Agent 的一个机制（循环、工具、上下文、会话、压缩、权限、沙箱、子 Agent……）：先用几十行代码亲手实现，再对照 [Pi](https://github.com/earendil-works/pi)（MIT）的源码，看生产级 Agent 怎么设计、为什么这样取舍。Pi 刻意没有内置的能力——权限规则、兼容 Claude Code 协议的 Hooks、长期记忆、子 Agent、后台任务——我们用 Pi 的扩展 API 自己写出来。

学完你手里会有：

- **mox-agent**：一个从零写成、零依赖、能接真实模型的命令行 Agent，每一行你都知道为什么在那里；
- **一组 Pi 扩展**：补齐 Pi 没有内置的生产能力；
- **一张源码地图和一个面试题库**：讲得出“为什么这样设计”。

## 快速开始

需要 Node.js 22.19 或更新版本（课程代码是 TypeScript，Node 直接运行，不需要编译）。

```bash
git clone https://github.com/Jialei-03/learn-pi-agent.git
cd learn-pi-agent && npm install

# 运行第一个 Agent（没有 API Key 时自动使用脚本模型，离线、免费）
cd labs/fixtures/mox-project
node ../../../mox/stage-01/agent.ts "这个项目是做什么的？"
```

接任意 OpenAI 兼容的模型（DeepSeek、通义、Kimi、本地 Ollama……）：

```bash
export MOX_BASE_URL=https://api.deepseek.com/v1
export MOX_API_KEY=sk-...
export MOX_MODEL=deepseek-chat
```

## mox 命令行

`mox/src/cli.ts` 是逐章完善后的完整 Agent（第 5 章起）：

```bash
node mox/src/cli.ts                       # 交互模式
node mox/src/cli.ts -p "修复失败的测试"     # 一次性执行
node mox/src/cli.ts --continue            # 继续最近的会话；上次没跑完会从断点恢复（第 18 章）
node mox/src/cli.ts --mode json -p "…"    # JSON 事件流（第 19 章）
node mox/src/cli.ts --mode rpc            # RPC 模式：stdin 发命令，stdout 收响应和事件（第 19 章）
node mox/src/cli.ts --trust               # 加载项目里的扩展、Skills、MCP 配置、子 Agent 定义
node mox/src/cli.ts --ext extensions/permissions/mox.ts --ext extensions/hooks/mox.ts   # 加载本仓库的扩展
```

用户级的配置放在 `~/.mox/`：`extensions/`（扩展）、`skills/`（Skills）、`prompts/`（提示模板）、`agents/`（子 Agent）、`mcp.json`（MCP 服务器）。`extensions/` 目录下的扩展（权限、钩子、沙箱、记忆、检查点、目标循环……）都有 mox 版本，用 `--ext` 加载；沙箱扩展要放在最后（第 15 章）。

## 课程网站

正文在 `course/*.md`，网站由 `site/build.ts` 生成：

```bash
npm run build                 # 生成 site/dist
node site/serve.ts            # 本地预览 http://127.0.0.1:4321/
npm run check                 # 只做检查，不写文件
```

构建需要 Pi 源码作为对照基准，默认路径是仓库旁边的 `../pi-v1.5.0`（可用环境变量 `PI_SRC` 修改）：

```bash
git clone --branch v1.5.0 https://github.com/earendil-works/pi.git ../pi-v1.5.0
```

构建时会做三件事，保证正文和代码永远一致：

1. **Pi 源码摘录**（`@pi 文件#行号` 或 `#函数名`）从固定提交 `f9a2636`（v1.5.0）中实时读取，文件不存在或行号越界会让构建失败；
2. **实验输出**（`@lab 命令`）在构建时真正运行，页面上的终端输出不是手写的；
3. **消息回放**（`@trace 命令`）运行实验并录制每一步，生成可交互的回放。

## 目录

| 路径 | 内容 |
| --- | --- |
| `course/` | 课程正文（Markdown）与目录 `syllabus.ts` |
| `mox/` | 从零实现的 Agent。`stage-01/` 是第 1 章的单文件版本，`src/` 是逐章完善的模块 |
| `extensions/` | 第 9 章起写的扩展：web-fetch、记忆、钩子、权限、沙箱、计划模式、任务清单、检查点、后台命令、目标循环。大多同时有 Pi 版本（`index.ts`）和 mox 版本（`mox.ts`），共用一份核心逻辑 |
| `evals/` | 第 20 章的评测框架和评测任务 |
| `labs/` | 每章的可运行实验，以及 mox 与 Pi 的对照实验；`labs/*/recorded/` 是用真实模型录制的运行记录 |
| `site/` | 网站生成器、模板、样式与交互脚本 |
| `assets/` | Mox 插画；`assets/course/BRIEFS.md` 是待生成插画的需求 |

## 版本基准

| | |
| --- | --- |
| Pi 源码 | [v1.5.0 · `f9a2636`](https://github.com/earendil-works/pi/tree/f9a26365568127461c47a07a37dcb42c140a3ac5) |
| 实验使用的 npm 包 | `@earendil-works/pi-*@1.5.0`（与源码同一版本） |
| Claude Code 对照 | 只引用 [官方文档](https://code.claude.com/docs) |

## License

MIT。Pi 源码摘录遵循 Pi 的 MIT 许可；Claude Code 相关内容仅引用其公开文档。
