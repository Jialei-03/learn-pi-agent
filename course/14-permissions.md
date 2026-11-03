---
motto: 权限系统要回答的不是“模型想做什么”，而是“谁有权决定它能做什么”。
learn:
  - 两种安全哲学：Claude Code 的“逐项审批”与 Pi 的“靠隔离”
  - Claude Code 的规则语法：Tool(说明符)、deny → ask → allow、权限模式
  - 把一行命令变成可以判断的东西：复合命令、包装命令、命令替换、只读命令、重定向
  - 路径规则与符号链接，以及为什么规则不是安全边界
  - 给 Pi 写一个规则式权限扩展；没有界面时怎么办
prereq: 第 4、9、13 章
time: 70 分钟
build: extensions/permissions —— 兼容 Claude Code 规则语法的权限扩展（Pi 与 mox 两个版本，共用规则引擎）
---

## 两种安全哲学

Agent 会犯错（在错误的目录里执行 `rm`），也会被利用（第 1、9、10、12 章反复出现的提示注入）。问题是：由谁、在哪一层拦住它？

**Claude Code 的答案是审批。** 工具分成几级：读文件不需要批准；执行命令、修改文件、访问网络需要用户点头。为了不让用户被确认框淹没，又有一整套规则（哪些命令直接放行、哪些一律禁止）和模式（比如“自动接受文件修改”）。

**Pi 的答案是隔离。** 它的安全文档开门见山：

@pi packages/coding-agent/docs/security.md#L3-L7

Pi 默认不审批任何工具调用。它的立场是：盯着对话记录、审查改动都不构成安全边界；真正的安全来自限制 Agent **能接触到**的文件、凭据、进程和网络——在容器、虚拟机或沙箱里运行。

两种答案并不矛盾，它们防的是不同的东西。审批让人参与关键决定，适合交互式地使用；隔离给出硬性的边界，即使审批被绕过、被用户随手点了“是”，损失也有上限。成熟的方案两者都要：Claude Code 也有沙箱（第 15 章），Pi 也有第 9 章那样的确认扩展。这一章补上 Pi 缺少的那一半：一个与 Claude Code 规则语法兼容的权限扩展。

## 规则

@figure assets/course/ch14-permissions.png 权限：先查 deny，再查 ask，最后才是 allow；规则拦的是常见的写法，不是边界

### 语法与顺序

规则的形式是 `工具` 或 `工具(说明符)`，分成三组：

```json
{
  "permissions": {
    "deny":  ["Bash(git push *)", "Bash(curl *)", "Read(.env)"],
    "ask":   ["Bash(npm install *)"],
    "allow": ["Bash(npm run *)", "WebFetch(domain:docs.python.org)", "mcp__issues__search_issues"]
  }
}
```

| 规则 | 匹配 |
| --- | --- |
| `Bash` | 所有命令 |
| `Bash(npm run *)` | 以 `npm run` 开头的命令；`*` 匹配任意文本 |
| `Read(.env)`、`Edit(/src/**)` | 路径，gitignore 风格（下文详述） |
| `WebFetch(domain:docs.python.org)` | 访问这个域名 |
| `mcp__github`、`mcp__github__search_code` | 一个 MCP 服务器的全部工具、某一个工具（第 12 章的命名） |

判断顺序是 **deny → ask → allow**，第一个匹配的组决定结果，**和规则写得多具体无关**。`Bash(aws *)` 在 deny 里，`Bash(aws s3 ls)` 写进 allow 也没用——allow 不能在 deny 上开口子。这样设计是为了让 deny 规则可以放心地写：不会被别的什么规则意外覆盖。

一条**不带说明符的 deny**（比如 `"deny": ["WebFetch"]`）有特殊含义：这个工具直接从模型能看到的工具列表里去掉，而不是等模型调用时再拒绝。模型不会白白尝试，也少占上下文。

### 没有规则匹配时：模式

| 模式 | 行为 |
| --- | --- |
| `default` | 工作目录内的读取、只读命令直接执行；修改文件、其他命令、网络访问需要确认 |
| `acceptEdits` | 再加上：工作目录内的文件修改自动接受 |
| `plan` | 只能读，任何修改和非只读命令都拒绝（第 16 章的计划模式建立在它之上） |
| `dontAsk` | 需要确认的一律拒绝，只执行规则明确允许的（适合无人值守） |
| `bypassPermissions` | 不再询问，但 deny 规则仍然有效。只应在容器、虚拟机里使用 |

规则引擎的入口：

@code extensions/permissions/rules.ts#decidePermission collapse=true

## 一行命令，怎么判断

文件路径、域名都比较好判断，难的是 Bash：命令是一段自由文本，模型可以用无数种方式写出同一个效果。

### 复合命令

`npm run build && rm -rf /` 以 `npm run` 开头，但显然不能因为 `Bash(npm run *)` 就放行。规则引擎先把命令按 `&&`、`||`、`;`、`|`、`&`、换行拆成子命令（引号里的不算），**每一个**子命令都被允许，整条命令才放行；**任何一个**子命令匹配 deny 或 ask，整条命令就被拒绝或需要确认。`$(…)`、反引号和括号里的命令同样会执行，也要拿出来检查：

@code extensions/permissions/rules.ts#splitCommand collapse=true

拆不开的命令（引号没闭合、`npm test &&` 后面什么都没有）不能自动放行，只能交给用户。

### 包装命令与环境变量

`timeout 30 npm run test` 实际执行的是 `npm run test`。匹配之前要去掉这类不改变“实际执行什么”的前缀：`timeout`、`time`、`nice`、`nohup`、`stdbuf`、`command`，以及不带参数的 `xargs`。

开头的环境变量赋值要区别对待：匹配 deny 时，去掉所有赋值（`FOO=bar rm -rf tmp` 仍然是 `rm`）；匹配 allow 时，只去掉已知安全的变量。`PATH=/tmp/evil:$PATH npm run build` 看起来是 `npm run build`，实际执行的 `npm` 可能是攻击者放在 `/tmp/evil` 里的程序：

@code extensions/permissions/rules.ts#stripWrappers

### 只读命令

`ls`、`cat`、`grep`、`git status` 这类命令不改变任何东西，没必要每次都问。但“只读”要小心定义：`find` 带上 `-delete` 或 `-exec` 就不是只读的；`git` 只有 `status`、`log`、`diff` 等几个子命令是；任何带输出重定向的命令（`ls > files.txt`）都在写文件。

只读也不等于什么都能读：`cat .env` 和用 `read` 工具读 `.env` 是一回事，Read 的 deny 规则对 `cat`、`head`、`tail` 这类读文件的命令同样生效。

### 实验

一组规则，二十九种情况，每一行的“期望”都来自 Claude Code 权限文档描述的行为：

@lab node labs/ch14/rules.ts

### 规则看不到的东西

注意实验中期望为 `ask` 而不是 `deny` 的几行：

- `python3 -c "print(open('.env').read())"`：规则只认识 `cat` 这类命令，不知道 Python 脚本里打开了什么文件。
- `git -C . push origin main`：`Bash(git push *)` 匹配不到这种写法。同理，`/usr/bin/curl`、`sh -c 'curl …'` 也绕得过 `Bash(curl *)`。

Claude Code 的文档也明确说了，deny 规则拦的是“模型通常会写出的那种调用”，**不是围绕某个程序的安全边界**。这里有一条一般原则：**黑名单总有漏洞，白名单更可靠。** 没有被明确允许的命令会落到“需要确认”，而不是被放行——这正是 allow 规则的检查比 deny 严格得多（每个子命令都要允许、只去掉安全的环境变量）的原因。要真正挡住 `.env` 被读取，需要在操作系统层面限制进程能访问的文件：这是第 15 章沙箱的工作。

## 路径规则

`Read` 和 `Edit` 的说明符用 gitignore 的语法，有四种锚点：

| 写法 | 基准 | 例子 |
| --- | --- | --- |
| `//path` | 文件系统根目录 | `Read(//etc/**)` |
| `~/path` | 家目录 | `Read(~/.ssh/**)` |
| `/path` | 规则所在配置文件对应的目录（项目配置就是项目根目录） | `Edit(/src/**)` |
| `path`、`./path` | 当前目录 | `Read(.env)` |

不含斜杠的模式（`.env`、`*.pem`）匹配任意深度，所以 `Read(.env)` 也挡住了 `config/.env`。注意 `/path` **不是**绝对路径——这是最常见的配置错误。

@code extensions/permissions/rules.ts#matchPath

还有两条规则：Read 的 deny 也挡住对同一路径的 Edit 和 Write（不能读的文件也不该能改）；路径要解析**符号链接**，否则一个指向 `.env` 的 `notes.txt` 就能绕过 `Read(.env)`。

符号链接还在写这一章时制造了一个真实的 bug：macOS 上临时目录在 `/var` 下，而 `/var` 本身是 `/private/var` 的符号链接。规则引擎一开始只解析了文件的真实路径，没有解析工作目录的，结果工作目录里的文件被判断为“在工作目录之外”，指向 `.env` 的链接反而被放行。实验的第一版有五行不符合期望，修复的办法是两边都解析（`realish`），连还不存在的新文件也要解析它的上级目录。权限代码里，路径比较几乎总是比看起来难。

## 装进 Pi

@code extensions/permissions/index.ts#createPermissionsExtension collapse=true

需要确认时，扩展弹出一个三选一的对话框：

- **允许一次**；
- **本会话都允许**：为这次调用生成规则，加入本会话的 allow 列表。Bash 按每个需要确认的子命令各生成一条精确的规则（批准 `git add -A && git commit -m "wip"`，得到的是两条规则，而不是一条拼起来的）；文件修改生成 `Edit(/**)`，只覆盖工作目录内；
- **拒绝**：原因作为工具错误交给模型。

**没有界面时**（`pi -p` 在 CI 里运行、通过 RPC 调用），没有人能回答“允许吗”，扩展按拒绝处理。这和第 9 章 Pi 官方的权限示例是同样的选择：拿不准的时候，拒绝。无人值守的场景应该把需要的操作提前写进 allow 规则，或者干脆在沙箱里用 `bypassPermissions`。

这个实验用脚本化的界面（按预先写好的答案选择）跑三种情况，最后用 mox 版本的扩展重复一遍：

@lab node labs/ch14/session.ts

几个细节：`npm run build` 匹配 allow 规则，没有弹窗；批准第一次 `edit` 时选了“本会话都允许”，紧接着的 `write` 就不再询问；`cat .env` 直接被拒绝，根本没有询问用户——deny 规则不给用户“点错”的机会。

mox 版本（`extensions/permissions/mox.ts`）需要一个让用户做选择的通道，所以 mox 的扩展上下文增加了 `select`：交互模式下，它把问题打印出来，把用户输入的下一行当作答案；`-p` 模式下没有 `select`，扩展按“没人能确认”处理。

### 和钩子的关系

第 13 章的 PreToolUse 钩子也能允许或拒绝工具调用，两者同时存在时听谁的？在 Pi 里，它们都是 `tool_call` 上的闸门（第 9 章）：任何一个说“拦下”，调用就被拦下；钩子说“允许”只是“我没有意见”，不能推翻权限规则的拒绝。Claude Code 的规则相同：PreToolUse 钩子返回 `allow` 不能绕过 deny 和 ask 规则，而返回退出码 2 的钩子在规则之前就拦下了调用。**放宽权限的只有用户自己，收紧权限的可以有很多方。**

::: compare Claude Code 的权限
- **auto 模式**：不再弹确认框，而是由一个后台的分类模型检查每个命令、每次网络请求是否符合用户的意图，不符合的才拦下。这是用模型对付“审批疲劳”的办法。
- **受保护的路径**：`.git`、`.claude` 这样的目录，即使在 acceptEdits 模式下也不会自动接受修改。
- **工作目录**：读取默认只限于工作目录和 `additionalDirectories`；可以配置为完全禁止访问之外的路径。
- **更细的 Bash 分析**：识别更多只读命令和危险参数（比如 `ps` 打印环境变量的写法、Windows 网络路径会泄露凭据），检查重定向和 `tee` 的写入目标。
- 用 SDK 时可以提供自己的审批函数（`canUseTool`），第 19 章会用到。

官方文档：[Configure permissions](https://code.claude.com/docs/en/permissions)
:::

## 面试题

先自己回答，再展开对照要点。

::: interview 如何为 coding agent 设计权限系统？
- **分级**：只读操作默认放行；修改文件、执行命令、访问网络需要确认。
- **规则**：allow / ask / deny，按 deny → ask → allow 判断，deny 不能被更具体的 allow 覆盖；规则可以按工具、命令前缀、路径、域名、MCP 服务器来写。
- **模式**：在“全部询问”和“全部放行”之间提供几档：自动接受编辑、只读的计划模式、无人值守时不询问而拒绝。
- **会话级授权**：“本会话都允许”生成精确的规则，而不是放开整个工具。
- **没有界面时出错拒绝**。
- **与隔离配合**：权限规则管“模型通常怎么做”，沙箱管“最坏能做到什么”。
- 规则要能放进版本库，团队共享；个人规则另放。
:::

::: interview 判断一条 Bash 命令能否执行，有哪些难点？
- 复合命令：要拆开，每个子命令都允许才放行；任何一个子命令命中 deny 就拒绝。
- 命令替换、子 shell 里的命令也会执行。
- 包装命令（`timeout`、`nice`、`xargs`）和环境变量赋值：匹配前要去掉；允许时不能越过可疑的赋值（`PATH=…`）。
- 通配符的位置：`Bash(git * main)` 会放行 `git -c core.fsmonitor=<脚本> diff main`。
- 只读的定义：`find -delete`、输出重定向都在写文件。
- 无法解析的命令要交给人。
- 根本局限：同一个效果有无数种写法（换路径、换解释器、`sh -c`），基于文本的规则不是安全边界。
:::

::: interview 为什么说权限规则不是安全边界？那什么才是？
规则匹配的是命令文本和工具参数，而同一个操作可以有无数种表达方式：`python -c` 读文件、`/usr/bin/curl` 代替 `curl`、写一个脚本再执行。规则能拦住模型“通常会写出”的那种调用，防止善意的模型犯错，但拦不住被注入的模型有意绕过。

安全边界要在操作系统或虚拟化层面：沙箱限制进程能访问的文件和网络、容器或虚拟机隔离主机、使用权限最小且短期有效的凭据。权限规则、钩子、审批在边界之内提供可控性和可见性。
:::

::: interview 用户被确认框烦得不行，怎么办？
- 读操作和只读命令默认不问。
- 用 allow 规则把常用、安全的命令（`npm run test`）提前放行，规则放进项目配置让团队共享。
- “本会话都允许”：一次确认覆盖同类操作。
- 合适的模式：信任当前任务时用 acceptEdits。
- 用分类模型自动审查（Claude Code 的 auto 模式），只把可疑的操作交给人。
- 在沙箱里运行，边界之内可以放心地少问。
- 注意：确认框太多，用户会养成不看就点“是”的习惯，审批就失去了意义。审批的数量本身就是安全问题。
:::

::: interview Agent 在 CI 里无人值守地运行，遇到需要确认的操作怎么办？
没人能确认，就不能“默认允许”，应该拒绝（dontAsk 模式，或者像本章的扩展那样没有界面时拒绝），并把拒绝原因交给模型，让它换一种做法或者报告失败。需要的操作提前写进 allow 规则；如果任务确实需要很大的权限，就在一次性的容器或虚拟机里用 bypassPermissions 运行，用隔离代替审批。还可以通过 SDK 提供一个审批回调，由程序按策略判断。
:::
