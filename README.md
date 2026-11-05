# Learn Pi Agent

**从零造一个 Coding Agent，再读懂一个生产级的。**

每一章拆开 Coding Agent 的一个机制（循环、工具、上下文、会话、压缩、权限、沙箱、子 Agent……）：先在 [Mox-agent](https://github.com/Jialei-03/Mox-agent) 里读懂、运行实现它的那几十行代码，再对照 [Pi](https://github.com/earendil-works/pi)（MIT）的源码，看生产级 Agent 怎么设计、为什么这样取舍。Pi 刻意没有内置的能力——权限规则、兼容 Claude Code 协议的 Hooks、长期记忆、子 Agent、后台任务——我们用 Pi 的扩展 API 自己写出来。

学完你手里会有：

- **mox**：一个约 680 行、零依赖、能接真实模型的命令行 Agent（[Mox-agent](https://github.com/Jialei-03/Mox-agent)），每一行你都知道为什么在那里；
- **一组扩展**：补齐 mox 和 Pi 没有内置的生产能力，大多同时有 mox 版本和 Pi 版本；
- **一张源码地图和一个面试题库**：讲得出“为什么这样设计”。

## 快速开始

需要 Node.js 22.19 或更新版本（课程代码是 TypeScript，Node 直接运行，不需要编译）。

```bash
git clone --recurse-submodules https://github.com/Jialei-03/learn-pi-agent.git
cd learn-pi-agent && npm install
```

`mox/` 是 [Mox-agent](https://github.com/Jialei-03/Mox-agent) 仓库的子模块，固定在课程对应的提交上。所有实验默认使用脚本模型，离线、免费。

## mox 命令行

mox 走 OpenAI 兼容接口，MiniMax、DeepSeek、OpenAI、OpenRouter、本地 Ollama 都可以：

```bash
export MOX_BASE_URL=https://api.minimaxi.com/v1
export MOX_API_KEY=你的 Key
export MOX_MODEL=MiniMax-M3.1-Flash

node mox/src/cli.ts                       # 交互模式（cd mox && npm link 之后可以直接用 mox）
node mox/src/cli.ts -p "修复失败的测试"     # 一次性执行
node mox/src/cli.ts -c                    # 继续这个目录最近一次的会话
node mox/src/cli.ts --trust               # 加载项目里的 .mox/ 和 .agents/skills
node mox/src/cli.ts -e extensions/permissions/mox.ts -e extensions/hooks/mox.ts   # 加载本仓库的扩展
```

用户级的配置放在 `~/.mox/`：`AGENTS.md`、`mcp.json`（MCP 服务器）、`extensions/`（扩展）、`skills/`（Skills）。`extensions/` 目录下的扩展（权限、钩子、沙箱、记忆、计划模式、检查点、后台命令、目标循环……）都有 mox 版本，用 `-e` 加载。

## 课程网站

正文在 `course/*.md`，网站由 `site/build.ts` 生成：

```bash
npm run build                 # 生成 site/dist
node site/serve.ts            # 本地预览 http://127.0.0.1:4321/
npm run check                 # 只做检查，不写文件（会运行全部实验，实验里的断言失败会让检查失败）
```

构建需要 mox 子模块（`git submodule update --init`）和 Pi 源码作为对照基准，默认路径是仓库旁边的 `../pi-v1.5.0`（可用环境变量 `PI_SRC` 修改）：

```bash
git clone --branch v1.5.0 https://github.com/earendil-works/pi.git ../pi-v1.5.0
```

构建时会做三件事，保证正文和代码永远一致（顶栏的“源码导图”由全部摘录自动生成）：

1. **源码摘录**：Pi（`@pi 文件#行号` 或 `#函数名`）从固定提交 `f9a2636`（v1.5.0）中实时读取，mox（`@code mox/src/…`）从子模块读取；文件不存在、行号越界或高亮行越界都会让构建失败；
2. **实验输出**（`@lab 命令`）在构建时真正运行，页面上的终端输出不是手写的；
3. **消息回放**（`@trace 命令`）运行实验并录制每一步，生成可交互的回放。

## 目录

| 路径 | 内容 |
| --- | --- |
| `course/` | 课程正文（Markdown）与目录 `syllabus.ts` |
| `mox/` | [Mox-agent](https://github.com/Jialei-03/Mox-agent) 子模块：课程动手部分用的 Agent，约 680 行，每个机制一个文件 |
| `extensions/` | 第 9 章起写的扩展：web-fetch、记忆、钩子、权限、沙箱、计划模式、任务清单、检查点、后台命令、目标循环。大多同时有 Pi 版本（`index.ts`）和 mox 版本（`mox.ts`），共用一份核心逻辑 |
| `evals/` | 第 20 章的评测框架和评测任务 |
| `labs/` | 每章的可运行实验，以及 mox 与 Pi 的对照实验；`labs/*/recorded/` 是用真实模型录制的运行记录 |
| `site/` | 网站生成器、模板、样式与交互脚本 |
| `assets/` | Mox 插画（`assets/course/` 是正文用到的配图） |

## 版本基准

| | |
| --- | --- |
| Pi 源码 | [v1.5.0 · `f9a2636`](https://github.com/earendil-works/pi/tree/f9a26365568127461c47a07a37dcb42c140a3ac5) |
| mox | [Mox-agent · `69cda3f`](https://github.com/Jialei-03/Mox-agent/tree/69cda3f4121cb3d0871c9f42ba3af65fa792e4cb)（子模块） |
| 实验使用的 npm 包 | `@earendil-works/pi-*@1.5.0`（与源码同一版本） |
| Claude Code 对照 | 只引用 [官方文档](https://code.claude.com/docs) |

## License

MIT。Pi 源码摘录遵循 Pi 的 MIT 许可；Claude Code 相关内容仅引用其公开文档。
