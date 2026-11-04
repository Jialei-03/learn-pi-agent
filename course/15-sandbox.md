---
motto: 规则管模型通常会怎么做，沙箱管它最坏能做到什么。
learn:
  - 隔离的四个层次：整个 Agent、只隔离工具、进程沙箱、语言沙箱
  - Pi 的两个扩展点：BashOperations 与 spawnHook
  - macOS Seatbelt 与 Linux bubblewrap：限制写、读、网络
  - 网络白名单为什么需要一个代理，代理挡不住什么
  - 项目目录里也有不能写的东西：git 钩子和 Agent 配置
  - codemode：模型写的代码在 QuickJS 里运行，工具是唯一的出口
prereq: 第 5、12、14 章
time: 70 分钟
build: extensions/sandbox —— 让 bash 在操作系统沙箱里运行、网络按域名放行的扩展（Pi 与 mox 两个版本）
---

## 规则挡不住的

第 14 章的实验留下了一个问题：`Read(.env)` 拦住了 `cat .env`，却拦不住 `python3 -c "print(open('.env').read())"`。规则检查的是命令的**文本**，而同一个效果有无数种写法。要真正保证 `.env` 读不到，限制必须加在更底层：不管进程是 bash、Python 还是一个编译好的二进制，只要它去打开那个文件，操作系统就拒绝。

这就是**沙箱**。它不关心模型写了什么，只关心进程做了什么。

## 隔离的四个层次

| 层次 | 例子 | 隔离了什么 | 代价 |
| --- | --- | --- | --- |
| 整个 Agent | Docker 容器、虚拟机、托管的沙箱服务 | 一切：Agent、扩展、MCP 服务器、工具 | 开发环境要搬进去；凭据要传进去；改动要同步出来 |
| 只隔离工具 | 远程执行（SSH）、微型虚拟机 | 工具执行的命令和文件操作 | Agent 本身和扩展还在宿主机上 |
| 进程沙箱 | macOS Seatbelt、Linux bubblewrap（本章） | bash 启动的整个进程树 | 只管 bash；read、write 这些工具在 Agent 进程里，仍由权限规则管 |
| 语言沙箱 | codemode 的 QuickJS（本章后半） | 模型写的脚本 | 脚本只能做工具允许的事 |

Pi 的文档列出了前两类的做法：

@pi packages/coding-agent/docs/containerization.md#L7-L16

越往上，隔离越彻底，也越重。日常在自己电脑上开发时，进程沙箱是一个很好的折中：不用改变工作方式，却给最危险的那个工具（bash）加上了硬边界。Claude Code 的沙箱就工作在这一层。

## Pi 的两个扩展点

Pi 的 bash 工具留了两个口子。一个是 `BashOperations`，可以**整个替换**命令的执行方式：

@pi packages/coding-agent/src/core/tools/bash.ts#L70-L93

注释里说得明白：比如通过 SSH 在远程机器上执行。Pi 自带的 SSH 示例和 Gondolin（微型虚拟机）示例，都是用同名工具替换内置的 `bash`、`read`、`write`，把操作转发到别处。

另一个是 `spawnHook`，在**启动进程的前一刻**改写命令、工作目录和环境变量：

@pi packages/coding-agent/src/core/tools/bash.ts#L177-L211

注意 `resolveSpawnContext` 还顺手从环境变量里删掉了 `PI_SESSION_ID`、`PI_MODEL` 等变量（除非明确要求暴露）：命令默认不该知道自己在哪个会话、哪个模型下运行。

本章的扩展用 `spawnHook`：工具的参数、输出、截断都和原来一样，对话记录里也是模型写的原始命令，只是进程启动时被包进了沙箱。

## 操作系统沙箱

@figure assets/course/ch15-sandbox.png 沙箱：命令在玻璃房里运行；只有一扇小窗通向代理，代理只放行白名单里的域名

macOS 上用 **Seatbelt**（`sandbox-exec`，Claude Code 在 macOS 上用的也是它），Linux 上用 **bubblewrap**（`bwrap`）。两者表达的是同一套策略：

- **写**：只能写项目目录和一个专用的临时目录；
- **读**：大部分文件可以读，但凭据目录（`~/.ssh`、`~/.aws`……）和指定的文件不行；
- **网络**：完全断开，或者只能连本地的一个代理。

生成 Seatbelt 策略：

@code extensions/sandbox/policy.ts#seatbeltProfile

Seatbelt 的规则后写的优先：先允许一切，再禁止所有写入，再放开可写的目录，再禁止其中受保护的路径。还有一个细节：策略里必须写**真实路径**。macOS 的 `/tmp`、`/var` 都是 `/private` 下的符号链接，内核看到的是解析后的路径——第 14 章的权限规则就在这里栽过跟头。

Linux 版本的参数：

@code extensions/sandbox/policy.ts#bwrapArgs

::: note 关于 Linux 部分
本书的实验在 macOS 上运行，`bwrapArgs` 是按 bubblewrap 的文档写的，没有在 Linux 上实际验证。注释里也说明了一个没有实现的部分：Linux 上要做到“只能连代理”，需要把代理通过 unix socket 接进独立的网络命名空间（Claude Code 用 socat 做这件事）。
:::

同样的命令，直接运行和在沙箱里运行：

@lab node labs/ch15/escape.ts

Python 读 `.env`、Node 在项目外写文件，这些第 14 章的规则看不到的操作，全被内核挡了下来。限制和命令用什么语言、怎么写都没有关系。

::: steps 一条 bash 命令是怎样被包进沙箱的
--- 模型写了一条规则看不穿的命令：用 Python 读 `.env`。对话记录里保存的也是这条原始命令，扩展不会改它。
sequenceDiagram
  participant M as 模型
  participant B as bash 工具
  participant X as 沙箱扩展
  participant K as 内核（Seatbelt）
  M->>B: bash：python 读 .env
  Note over B: 规则看不穿这条命令
--- bash 工具在**启动进程的前一刻**调用 `spawnHook`，把命令、工作目录、环境变量交给扩展。
sequenceDiagram
  participant M as 模型
  participant B as bash 工具
  participant X as 沙箱扩展
  participant K as 内核（Seatbelt）
  M->>B: bash：python 读 .env
  B->>X: spawnHook(context)
--- 扩展调用 `wrapCommand`：Seatbelt 下把命令改成 `sandbox-exec -f profile.sb /bin/bash -c '原命令'`，并给环境变量加上 `TMPDIR` 和代理变量（断网模式下代理变量被清空）。工具的参数、输出、截断规则都不变。
sequenceDiagram
  participant M as 模型
  participant B as bash 工具
  participant X as 沙箱扩展
  participant K as 内核（Seatbelt）
  B->>X: spawnHook(context)
  X-->>B: 包进 sandbox-exec，加 env
--- 进程在沙箱里启动。Python 不管怎么写，最终都要调用 `open`，这一步落到内核。
sequenceDiagram
  participant M as 模型
  participant B as bash 工具
  participant X as 沙箱扩展
  participant K as 内核（Seatbelt）
  X-->>B: 包进 sandbox-exec，加 env
  B->>K: 启动进程，open .env
--- 内核按 `seatbeltProfile` 生成的策略检查：`.env` 在禁止读取的列表里，直接拒绝，不关心发起者是 bash、Python 还是编译好的二进制。
sequenceDiagram
  participant M as 模型
  participant B as bash 工具
  participant X as 沙箱扩展
  participant K as 内核（Seatbelt）
  B->>K: 启动进程，open .env
  K-->>B: Operation not permitted
--- Python 抛出 `PermissionError`，这段输出和普通的失败一样回到模型。模型看到的是一个常规错误，可以据此调整做法，或者告诉用户需要什么权限。
sequenceDiagram
  participant M as 模型
  participant B as bash 工具
  participant X as 沙箱扩展
  participant K as 内核（Seatbelt）
  K-->>B: Operation not permitted
  B-->>M: PermissionError 结果
:::

## 项目目录里也有不能写的东西

实验的第二行：在项目里写一个 git 钩子。项目目录明明是可写的，为什么要拦？

因为沙箱只约束**沙箱里的进程**，而它写下的文件会留下来。`.git/hooks/pre-commit` 会在你下一次（在沙箱外）执行 `git commit` 时运行；`.git/config` 里的 `core.fsmonitor` 可以指定任意程序；`.pi/`、`.mox/`、`.claude/` 里的扩展和配置会在 Agent 下次启动时加载；`.vscode/` 里的任务会被编辑器执行。往这些地方写东西，等于在沙箱外面留了一个定时执行的命令。

@code extensions/sandbox/policy.ts#defaultDenyWrite

沙箱的边界不只在空间上，也在时间上：要考虑沙箱里留下的东西，之后会被谁、在什么权限下使用。同样的道理，shell 的启动文件（`~/.bashrc`、`~/.zshrc`）也不能写——好在它们不在项目目录里，本来就写不了。

## 网络：为什么需要一个代理

操作系统沙箱能按 IP 和端口限制网络，但我们想要的是按**域名**放行：允许 `registry.npmjs.org`，拒绝其他。域名和 IP 不是一一对应的（CDN 背后的 IP 随时在变，一个 IP 上可能托管着成千上万个网站），在内核层面按域名过滤几乎做不到。

解决办法是两层配合：

1. 沙箱禁止所有网络连接，**只允许连本机的一个端口**；
2. 这个端口上运行一个代理（在沙箱外，Agent 进程里），代理看到请求的域名，按白名单决定放不放行。

沙箱里的命令通过 `HTTP_PROXY`、`HTTPS_PROXY` 环境变量找到代理。HTTPS 请求用 `CONNECT` 建立隧道，代理只看得到域名，看不到加密的内容：

@code extensions/sandbox/proxy.ts#startProxy collapse=true

实验的最后三行展示了三种结果：白名单里的域名经代理放行；不在白名单里的被代理拒绝；试图绕过代理直接连接（`--noproxy`），被内核拒绝。不认代理环境变量的程序（比如 `ssh`、多数数据库驱动）会直接连不上——这是对的，出错时拒绝。

::: steps 沙箱里的网络：只有一扇通向代理的小窗
--- 启动代理后，`wrapCommand` 给命令设置 `HTTP_PROXY`、`HTTPS_PROXY` 等变量，指向本机的代理端口。命令发出的请求会先去找这个代理。
sequenceDiagram
  participant C as 沙箱里的 curl
  participant K as 内核（Seatbelt）
  participant P as 代理（沙箱外）
  participant W as 外部网站
  Note over C: wrapCommand 设置 HTTP_PROXY 为 http://localhost:代理端口
--- curl 读到变量，先连代理。沙箱策略禁止一切网络连接，**只放行这个本机端口**，所以这条连接通过。
sequenceDiagram
  participant C as 沙箱里的 curl
  participant K as 内核（Seatbelt）
  participant P as 代理（沙箱外）
  participant W as 外部网站
  Note over C: wrapCommand 设置 HTTP_PROXY 为 http://localhost:代理端口
  C->>K: 连接 localhost:代理端口
  K-->>C: 允许：策略只放行这一个本机端口
--- 代理（在沙箱外，Agent 进程里）读出请求的域名，`hostAllowed` 对照白名单：`localhost` 在名单里，放行并转发，内容经代理回到命令。每个决定都通过 `onProxyDecision` 记录下来。
sequenceDiagram
  participant C as 沙箱里的 curl
  participant K as 内核（Seatbelt）
  participant P as 代理（沙箱外）
  participant W as 外部网站
  C->>P: 请求 localhost 的页面
  Note over P: hostAllowed：localhost 在白名单里
  P->>W: 转发请求
  W-->>C: 经代理返回内容
--- 换成 `127.0.0.1`：它不在白名单里，`hostAllowed` 为假，代理回复 403 和一句“沙箱代理拒绝访问 127.0.0.1”。HTTPS 则是在 `CONNECT` 阶段按主机名拒绝。
sequenceDiagram
  participant C as 沙箱里的 curl
  participant K as 内核（Seatbelt）
  participant P as 代理（沙箱外）
  participant W as 外部网站
  C->>P: 请求 127.0.0.1 的页面
  Note over P: hostAllowed：不在白名单里
  P-->>C: 403：沙箱代理拒绝访问 127.0.0.1
--- 最后一招：`--noproxy` 绕过代理直接连外网。这次连的不是那个本机端口，内核直接拒绝，curl 以退出码 7 失败。白名单靠的是内核封死其他出口，不是靠命令“自觉”用代理。
sequenceDiagram
  participant C as 沙箱里的 curl
  participant K as 内核（Seatbelt）
  participant P as 代理（沙箱外）
  participant W as 外部网站
  P-->>C: 403：沙箱代理拒绝访问 127.0.0.1
  C->>K: curl --noproxy 直连外部地址
  K-x C: 拒绝：连接失败，退出码 7
:::

代理挡不住的东西也要心里有数：

- **白名单里的域名可能被用来传数据。** 放行 `github.com`，命令就可以把你的代码推送到任何一个 GitHub 仓库。白名单要尽量具体，优先只读的源（比如软件包仓库）。
- **代理不检查内容**，只检查域名。
- 断网模式下要清空代理环境变量。写这一章时就遇到过：作者的电脑配置了一个本地代理，沙箱里的命令继承了它，实验结果随机器不同而不同。

## 装进 Pi

@code extensions/sandbox/index.ts#createSandboxExtension collapse=true

在一个真实的 Pi 会话里，模型执行几个命令：

@lab node labs/ch15/pi-sandbox.ts

正常的开发操作（在项目里写文件、运行 node）不受影响；读凭据、写到桌面、上网都被挡下。模型看到的是普通的 “Operation not permitted” 错误，它可以据此调整做法，或者告诉用户需要什么权限。

mox 没有 `spawnHook`，`extensions/sandbox/mox.ts` 换了一种办法：在 `tool_call` 里直接改写 `bash` 的 `command` 参数。这样做有一个顺序问题：权限扩展（第 14 章）必须在它**之前**加载，否则权限规则看到的将是改写后的 `sandbox-exec …` 命令。

同一件事——“在进程启动前把 bash 命令包进沙箱”——Pi 和 mox 的两种做法：

::: tabs
@@ Pi
@code extensions/sandbox/index.ts#L45-L50
用 `spawnHook` 在启动进程的一刻改写命令和环境变量，工具的参数和对话记录不变。
@@ mox
@code extensions/sandbox/mox.ts#L33-L39
没有 `spawnHook`，就在 `tool_call` 里直接改 `event.input.command`，环境变量用 `env` 命令带进去；所以这个扩展必须最后加载。
:::

还要记住沙箱**只管 bash**。`read`、`write`、`edit` 运行在 Agent 进程里，由权限规则管；钩子脚本、MCP 服务器、扩展同样不在沙箱里。Claude Code 也是这样划分的。要连同这些一起隔离，就得把整个 Agent 放进容器或虚拟机。

## codemode：语言级的沙箱

第 12 章提到过 codemode：模型不逐个调用工具，而是写一段 JavaScript，在脚本里调用工具、处理结果。脚本运行在哪里？

@pi packages/coding-agent/docs/codemode.md#L7-L7

QuickJS 是一个很小的 JavaScript 解释器，Pi 把它编译成 WebAssembly 运行。脚本里没有 `require`、没有 `fetch`、没有文件系统、没有定时器，唯一能接触外部世界的方式是 `tools.*`——而每一次工具调用都会经过正常的工具流水线：`tool_call` 事件、权限检查、钩子，并带着 `parentToolCallId` 标明是哪个脚本发起的。

这是和进程沙箱完全不同的思路：不是“允许一切，再禁止危险的”，而是“什么都没有，只给你这几个函数”。

@lab node labs/ch15/codemode.ts

实验里的脚本做了三件事：探测环境（`require`、`fetch`、`process` 都不存在）；调用 MCP 工具读取一百多 KB 的构建日志，只把最后一行交给模型——模型收到的结果只有三百个字符；试图通过 `tools.read` 读取 `.env`，被第 14 章的权限规则拒绝。

这个实验还暴露了一个设计问题。第一次运行时，权限扩展把 `codemode` 当作一个普通的未知工具，要求确认，而实验没有界面，整个脚本都被拒绝了。可是 `codemode` 本身没有任何副作用，脚本里的每一次工具调用都会单独检查。正确的做法是**检查效果，不检查容器**：权限扩展默认放行 `codemode` 和 `tool_search` 这类“元工具”，把检查留给它们发起的具体调用。

codemode 带来的好处不止安全：

- **省上下文**：大结果在脚本里处理，只有结论进入上下文（第 12 章的问题）。
- **组合**：循环、条件、并行调用写在一个脚本里，一次请求完成原来要好几轮的工作。
- **模型擅长写代码**：比起几十个工具定义，模型更熟悉“调用一个函数”。

2025 年前后，好几家公司提出了类似的思路（比如 Cloudflare 的 Code Mode，Anthropic 关于用代码执行调用 MCP 工具的文章）。

::: compare Claude Code 的沙箱
- macOS 用 Seatbelt，Linux 和 WSL2 用 bubblewrap，网络经过沙箱外的代理按域名放行，原生 Windows 不支持。开源实现是 `@anthropic-ai/sandbox-runtime`。
- 默认可写：工作目录和临时目录；默认**可读**大部分文件，包括 `~/.ssh`，需要用 `denyRead` 收紧（本章的扩展默认禁止读凭据目录，取舍不同）。`.git/hooks`、`.git/config`、shell 启动文件等受保护的路径不能写。
- 遇到不在白名单里的域名时，交互模式下询问用户。
- **沙箱内自动放行**：开启后，沙箱里的 bash 命令不再逐个确认——边界已经由沙箱保证了。deny 规则和显式的 ask 规则仍然有效。
- **逃生口**：命令在沙箱里失败时，模型可以带上 `dangerouslyDisableSandbox` 参数重试，这次在沙箱外运行，需要用户批准；可以配置为完全禁止。
- 沙箱只覆盖 Bash 等命令工具，不覆盖 Read、Edit、WebFetch、钩子和 MCP 服务器。

官方文档：[Sandboxing](https://code.claude.com/docs/en/sandboxing)
:::

## 面试题

先自己回答，再展开对照要点。

::: interview Coding agent 有哪些隔离方案？各自的取舍是什么？
- **整个 Agent 放进容器或虚拟机**：隔离最彻底（扩展、MCP 服务器、工具都在里面），但开发环境要搬进去，凭据和改动要进出。
- **只隔离工具**（远程执行、微型虚拟机）：Agent 留在宿主机，工具在隔离环境里执行；扩展和 Agent 本身不受限。
- **进程沙箱**（Seatbelt、bubblewrap）：给 bash 启动的进程树加上文件和网络限制，不改变工作方式，开销小；只覆盖 bash。
- **语言沙箱**（codemode 的 QuickJS）：模型写的代码只能调用给定的函数，每次调用都经过权限检查。
- 实践中组合使用：进程沙箱 + 权限规则用于日常开发；无人值守或高风险任务放进一次性的容器。
:::

::: interview 实现一个命令沙箱，要限制哪些方面？
- **文件写入**：只允许项目目录和专用临时目录；项目里仍要保护会在沙箱外被执行的文件（git 钩子和配置、Agent 配置与扩展、编辑器任务、shell 启动文件）。
- **文件读取**：凭据和密钥（`~/.ssh`、`~/.aws`、`.env`）。
- **网络**：默认断开，按域名白名单经代理放行。
- **进程间通信**：unix socket（比如 Docker 的 socket 等于宿主机的 root）、macOS 的 Apple Events。
- **环境变量**：不把宿主机的密钥、会话信息传进去。
- **资源**：超时、进程树的清理（第 5 章），必要时限制 CPU 和内存。
- 路径要按真实路径处理，注意符号链接。
:::

::: interview 如何实现按域名的网络白名单？有哪些局限？
内核层面难以按域名过滤（IP 与域名不是一一对应），所以沙箱只允许连接本机的一个代理端口，代理（在沙箱外）读取请求的目标域名：HTTP 请求看完整 URL，HTTPS 看 `CONNECT` 的主机名，按白名单放行。命令通过 `HTTP_PROXY` 等环境变量使用代理，不认代理的程序直接连不上。

局限：代理不检查加密内容；白名单里的域名可以被用来上传数据（放行 GitHub 就能推送到任意仓库）；放行的范围要尽量小、尽量是只读的源；断网时要清空继承来的代理变量。
:::

::: interview 什么是 codemode（代码执行模式）？它为什么既省 token 又更安全？
模型不直接逐个调用工具，而是写一段脚本，在脚本里把工具当函数调用，处理结果后只返回结论。

省 token：大结果（日志、搜索结果、文件列表）留在脚本里过滤，不进入上下文；多次调用合并到一次请求里，减少来回。

更安全：脚本运行在语言级沙箱里（比如 QuickJS），没有文件系统、网络、进程这些能力，唯一的出口是工具；每次工具调用都照常经过权限检查和钩子。权限系统应该检查脚本发起的具体调用，而不是脚本本身。
:::

::: interview 沙箱和权限规则怎么配合？
两者管的范围不同：沙箱是硬边界，管 bash 启动的进程最坏能做到什么；权限规则管模型的工具调用是否需要确认，也覆盖沙箱管不到的工具（read、write、web_fetch、MCP）。

有了沙箱，可以少问：沙箱内的 bash 命令自动放行（Claude Code 的做法），确认留给真正越界的操作——比如要求在沙箱外运行的命令、访问白名单之外的域名。deny 规则在两种情况下都有效。顺序上，权限检查要看到模型原本写的命令，所以改写命令的沙箱扩展要放在最后。
:::
