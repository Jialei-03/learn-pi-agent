---
motto: 写在提示里的规矩是请求，写成钩子的规矩是保证。
learn:
  - 钩子和扩展的区别：进程外的命令、与语言无关、写配置就能用、团队可以共享
  - Claude Code 的钩子协议：事件、匹配器、stdin 输入、退出码与 JSON 输出
  - 把协议映射到 Pi 的扩展事件：每个钩子在 Agent 循环里的位置
  - 失败语义：钩子默认“出错放行”，安全检查该怎么写
  - 典型用法与陷阱：拦截、改写、脱敏、质量门禁，以及无限循环
prereq: 第 4、9 章
time: 60 分钟
build: extensions/hooks —— 兼容 Claude Code 钩子协议的扩展（Pi 与 mox 两个版本，共用协议实现）
---

## 提示是请求，钩子是保证

你在 AGENTS.md 里写了“修改代码后运行 prettier”“不要读 .env 文件”“结束前先跑测试”。大多数时候模型会照做，但不是每次都会——上下文长了、任务复杂了，它就可能忘记。提示里的规矩本质上是**请求**。

**钩子**（hooks）把这些规矩变成**保证**：在 Agent 生命周期的固定位置，自动执行一条命令，由命令的结果决定放行、拦截还是改写。模型记不记得都没关系。

第 9 章的扩展也能做到这些，为什么还要钩子？

| | 扩展（第 9 章） | 钩子 |
| --- | --- | --- |
| 形式 | Agent 进程里的 TypeScript 代码 | 一条外部命令：shell、Python、任何语言 |
| 接口 | Agent 专属的 API（`pi.on`） | stdin 进 JSON，退出码和 stdout 出结果 |
| 能力 | 几乎无限：注册工具、改界面、控制会话 | 有限：在固定事件上放行、拦截、改写、补充信息 |
| 门槛 | 要懂这个 Agent 的 API | 会写脚本就行，写在配置文件里 |
| 适合 | 给 Agent 增加能力 | 给团队制定规矩 |

钩子的接口足够简单，同一份钩子脚本可以在不同的 Agent 里使用。Claude Code 的钩子协议是目前事实上的参考，这一章给 Pi 和 mox 实现这套协议：为 Claude Code 写的钩子脚本，不用改一行就能在 Pi 里运行。

## 协议

### 配置

钩子写在配置文件里，按事件分组，每组用 `matcher` 筛选工具：

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "sh .claude/hooks/block-dangerous.sh" }] },
      { "matcher": "Read|Edit|Write", "hooks": [{ "type": "command", "command": "node .claude/hooks/protect-env.mjs", "timeout": 10 }] }
    ],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node .claude/hooks/require-tests.mjs" }] }]
  }
}
```

`matcher` 的规则：空、`*` 或省略表示全部；只包含字母、数字、`_`、`-` 和 `|` 时，精确匹配其中之一（`Edit|Write`）；其他写法当作正则表达式（`mcp__github__.*`）。只有工具相关的事件看 `matcher`。

@code extensions/hooks/protocol.ts#matches

### 事件

Claude Code 定义了二十多种事件，我们实现最常用的六种，并对应到 Pi 的扩展事件：

| 钩子事件 | 什么时候 | 能做什么 | Pi 的事件 |
| --- | --- | --- | --- |
| `SessionStart` | 会话开始 | 给模型补充背景信息 | `session_start` |
| `UserPromptSubmit` | 用户提交提示，模型看到之前 | 拦下提示；补充信息 | `input`、`before_agent_start` |
| `PreToolUse` | 工具执行前 | 允许、拒绝、要求确认；改写参数 | `tool_call` |
| `PostToolUse` | 工具执行后，结果交给模型前 | 替换结果；补充信息 | `tool_result` |
| `Stop` | 模型准备结束这次运行 | 不让它停，要求继续 | `agent_before_settle` |
| `SessionEnd` | 会话结束 | 清理、记录 | `session_shutdown` |

<figure class="diagram">
<svg viewBox="0 0 720 170" role="img" aria-label="钩子在 Agent 运行中的位置">
<g font-size="12" text-anchor="middle">
<rect x="10" y="62" width="88" height="40" rx="6" fill="var(--accent-soft)" stroke="var(--accent)"/><text x="54" y="86" fill="var(--accent-ink)">SessionStart</text>
<rect x="112" y="62" width="112" height="40" rx="6" fill="var(--accent-soft)" stroke="var(--accent)"/><text x="168" y="86" fill="var(--accent-ink)">UserPromptSubmit</text>
<rect x="244" y="28" width="330" height="108" rx="10" fill="var(--bg-soft)" stroke="var(--line-2)" stroke-dasharray="4 3"/>
<text x="409" y="46" font-size="11" fill="var(--muted)">Agent 循环（第 3 章）</text>
<rect x="258" y="62" width="62" height="40" rx="6" fill="var(--ink)"/><text x="289" y="86" fill="var(--bg)">模型</text>
<rect x="334" y="62" width="82" height="40" rx="6" fill="var(--accent-soft)" stroke="var(--accent)"/><text x="375" y="86" fill="var(--accent-ink)">PreToolUse</text>
<rect x="430" y="62" width="46" height="40" rx="6" fill="var(--bg)" stroke="var(--line-2)"/><text x="453" y="86" fill="var(--ink)">工具</text>
<rect x="490" y="62" width="74" height="40" rx="6" fill="var(--accent-soft)" stroke="var(--accent)"/><text x="527" y="86" fill="var(--accent-ink)">PostToolUse</text>
<path d="M527 104V122H289V104" fill="none" stroke="var(--faint)" stroke-width="1.5"/><text x="409" y="132" font-size="11" fill="var(--faint)">还有工具调用：下一轮</text>
<rect x="590" y="62" width="56" height="40" rx="6" fill="var(--accent-soft)" stroke="var(--accent)"/><text x="618" y="86" fill="var(--accent-ink)">Stop</text>
<path d="M618 60V14H289V60" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="4 3"/><text x="453" y="10" font-size="11" fill="var(--accent-ink)">block：带着原因继续</text>
<rect x="656" y="62" width="58" height="40" rx="6" fill="var(--accent-soft)" stroke="var(--accent)"/><text x="685" y="80" font-size="11" fill="var(--accent-ink)">Session</text><text x="685" y="94" font-size="11" fill="var(--accent-ink)">End</text>
<g stroke="var(--faint)" stroke-width="1.5"><path d="M98 82H112"/><path d="M224 82H258"/><path d="M320 82H334"/><path d="M416 82H430"/><path d="M476 82H490"/><path d="M574 82H590"/><path d="M646 82H656"/></g>
</g>
</svg>
<figcaption>橙色的六个位置可以挂钩子。PreToolUse、PostToolUse 每次工具调用都会运行，Stop 能把即将结束的运行拉回循环。</figcaption>
</figure>

### 输入

钩子从 stdin 读到一个 JSON 对象。公共字段有 `session_id`、`transcript_path`、`cwd`、`hook_event_name`，再加上事件自己的字段：`UserPromptSubmit` 有 `prompt`；`PreToolUse` 有 `tool_name`、`tool_input`；`PostToolUse` 再多一个 `tool_response`；`Stop` 有 `stop_hook_active`、`last_assistant_message`。

### 输出

钩子用两种方式回答。

**退出码**是最简单的方式：

| 退出码 | 含义 |
| --- | --- |
| 0 | 成功。stdout 如果是一个 JSON 对象，按下面的字段解读；否则是普通文本（只有 `SessionStart`、`UserPromptSubmit` 会把它交给模型） |
| 2 | **阻止**。stderr 是原因：`PreToolUse` 拦下工具，`UserPromptSubmit` 拦下提示，`Stop` 不让停；`PostToolUse` 时工具已经执行了，只能把原因告诉模型 |
| 其他 | 钩子自己出错了。**不阻止**，只提示用户 |

**JSON 输出**能表达更精细的决定：

- `PreToolUse`：`hookSpecificOutput.permissionDecision` 是 `allow`、`deny` 或 `ask`（要求用户确认），附带原因；`updatedInput` 改写工具参数。多个钩子意见不同时，`deny` 优先于 `ask`，`ask` 优先于 `allow`。
- `PostToolUse`：`updatedToolOutput` 替换模型看到的结果。
- `UserPromptSubmit`、`Stop`：`"decision": "block"` 加 `reason`。
- 各事件都可以用 `additionalContext` 给模型补充信息，用 `systemMessage` 提示用户，用 `"continue": false` 让 Agent 整个停下。

合并多个钩子结果的实现：

@code extensions/hooks/protocol.ts#interpret collapse=true

## 映射到 Pi

### 让 Claude Code 的钩子脚本直接可用

为 Claude Code 写的钩子脚本，期待的是 Claude Code 的工具名和参数：`Bash` 的 `tool_input.command`，`Edit` 的 `file_path`（绝对路径）、`old_string`、`new_string`。Pi 的工具叫 `bash`、`edit`，参数是 `path` 和 `edits` 数组。扩展在两者之间翻译，钩子用 `updatedInput` 改写的参数再翻译回来：

@code extensions/hooks/protocol.ts#toClaudeTool

MCP 工具不用翻译：Pi 和 Claude Code 用的都是 `mcp__服务器__工具`（第 12 章）。

### 每个事件接到哪里

@code extensions/hooks/index.ts#createHooksExtension collapse=true

几处值得注意：

- **补充信息放在哪里**，影响提示缓存（第 6 章）。`SessionStart` 的信息整个会话不变，放进系统提示的一个小节；`UserPromptSubmit` 的信息每次不同，作为一条隐藏消息跟在用户提示后面；工具相关的信息附在那次工具结果的末尾。
- **改写参数**用 Pi 的约定：就地修改 `event.input`。
- **Stop** 对应 Pi 的 `agent_before_settle`：运行真正结束前的最后一个决策点，处理函数可以追加记录，并要求再跑一轮：

@pi packages/coding-agent/src/core/extensions/types.ts#L1035-L1050

扩展把钩子给出的原因作为一条消息追加，返回 `continue: true`，模型就会带着这个原因继续工作。

### 实验

一份 Claude Code 格式的钩子配置（`labs/fixtures/hooks/` 下的七个脚本），分别装进 Pi 和 mox，用同一个脚本模型执行：

@lab node labs/ch13/hooks.ts

逐条看：

1. `rm -rf build` 被 `block-dangerous.sh` 拦下——它只有几行 shell：`grep` 一下，往 stderr 写原因，`exit 2`。
2. `./deploy.sh production` 被改写成 `./deploy.sh production --dry-run`，模型从附在结果后面的信息里知道发生了什么。
3. 读取 `.env` 被拒绝，拒绝原因作为错误结果交给模型。
4. `cat config.txt` 正常执行，但模型看到的 API Key 已经被换成 `[REDACTED]`。工具确实读到了密钥，只是没有进入模型的上下文（也就不会被发给模型服务商）。
5. 模型说“都处理好了”，`Stop` 钩子不让它停：没提到测试。模型补跑测试，第二次说完成时，`stop_hook_active` 为真，钩子放行。
6. 带着密码的提示被 `UserPromptSubmit` 钩子拦下，根本没有发给模型。

最后是 mox 的结果：同一份配置，每一步都与 Pi 一致。mox 版本的扩展在 `extensions/hooks/mox.ts`，为此 mox 的扩展 API 增加了两样东西：`tool_result` 事件带上了 `toolCall`（并行调用时，靠它把 `PreToolUse` 留下的信息对应到正确的结果上），以及 `before_settle` 事件（对应 Pi 的 `agent_before_settle`，第 18 章还会用到）。

::: warn Stop 钩子与无限循环
一个总是返回 `block` 的 Stop 钩子会让 Agent 永远停不下来。协议的解决办法是 `stop_hook_active`：这一轮本来就是 Stop 钩子要求的，它就为真。钩子应该检查它，必要时放行。更稳妥的钩子会自己记录次数，或者检查真实的状态（测试结果文件、git 状态），而不是只看模型说了什么——模型完全可以在没跑测试的情况下写出“测试通过”。
:::

## 失败语义：钩子坏了怎么办

钩子是外部脚本，它自己也会出问题：依赖的 `jq` 没装、网络超时、输出格式不对。

@lab node labs/ch13/failures.ts

和第 9 章对比一下。第 9 章里，`tool_call` 扩展抛出异常，工具调用**被阻止**（出错时拒绝）。而按照 Claude Code 的协议，钩子出错时（退出码 1、超时、输出不是 JSON）工具调用**照常执行**（出错时放行）。

协议这样设计有它的道理：大多数钩子是锦上添花的（格式化、通知、记录日志），一个写坏的格式化脚本不应该让 Agent 完全无法工作。但这意味着**安全类的钩子要格外小心**：

- 拦截时明确地 `exit 2`，而不是依赖“脚本出错”；
- 不依赖可能不存在的工具。`jq: command not found` 是退出码 127，不是 2——一个依赖 jq 的安全钩子，在没装 jq 的机器上会**悄无声息地放行一切**；
- 输出 JSON 的钩子只能输出 JSON。实验里的第四种情况：shell 配置文件多打印了一行欢迎语，JSON 解析失败，`deny` 就失效了；
- 必要时配置 `"onFailure": "block"`，让钩子出错时按拒绝处理。

另一个实验结果：匹配的钩子**并行**运行，同一条命令即使在多个配置项里出现也只运行一次。所以不要假设钩子之间的执行顺序。

## 钩子能挡住什么，挡不住什么

`block-dangerous.sh` 拦住了 `rm -rf build`。可是 `rm -r -f build`、`find build -delete`、`python3 -c "import shutil; shutil.rmtree('build')"` 呢？用字符串匹配去识别危险命令，永远有漏网之鱼。

钩子适合做**规矩**：防止善意的模型犯错、统一团队的工作流程、留下审计记录。它不是**安全边界**。真正限制 Agent 能做什么，要靠权限系统（第 14 章）和沙箱（第 15 章）：前者决定哪些调用需要人确认，后者让即使被执行的命令也碰不到不该碰的东西。

钩子本身也带来了风险：

- **钩子是自动执行的代码。** 克隆一个陌生仓库，它的 `.claude/settings.json` 或 `.pi/hooks.json` 里的 `SessionStart` 钩子会在你打开 Agent 的那一刻运行。所以 Pi 版本的扩展只在信任项目后才读取项目里的配置。
- **钩子的输入包含模型生成的内容。** `tool_input.command` 是模型写的，可能被注入的内容所影响。钩子脚本如果用 `eval` 或者不加引号地拼接它，就给了攻击者一个执行命令的机会。
- **`additionalContext` 会进入模型的上下文**，内容应该是事实陈述，而不是命令式的“系统指令”。

::: compare Claude Code 的钩子还有什么
- **更多事件**：`PermissionRequest`（权限弹窗出现时）、`PreCompact` / `PostCompact`、`SubagentStart` / `SubagentStop`、`Notification`（比如等待用户输入时发桌面通知）、`PostToolUseFailure` 等二十多种。
- **更多类型**：除了 `command`，还有 `http`（把输入 POST 到一个地址）、`mcp_tool`（调用 MCP 工具）、`prompt`（让模型做一次判断）、`agent`（启动一个子 Agent 去检查条件）。
- **`if` 字段**：用权限规则的语法进一步筛选，比如 `Bash(git *)`。
- **`defer`**：在非交互模式下暂停这次工具调用，以后再恢复。
- 钩子也可以写在 Skill 和子 Agent 的元信息里，只在它们生效期间运行。

官方文档：[Hooks reference](https://code.claude.com/docs/en/hooks)
:::

## 面试题

先自己回答，再展开对照要点。

::: interview 钩子（hooks）和插件 / 扩展有什么区别？各适合什么场景？
钩子是在生命周期固定位置执行的外部命令，通过 stdin JSON 和退出码 / stdout 与 Agent 交流，语言无关，写在配置里，适合团队规矩：拦截危险操作、改写参数、脱敏、格式化、质量门禁、审计、通知。

扩展是运行在 Agent 进程里的代码，使用 Agent 专属的 API，能力强得多（注册工具、命令、界面，控制会话），适合给 Agent 增加能力。代价是门槛更高，和具体 Agent 绑定，出错可能影响 Agent 本身。

二者可以结合：钩子系统本身就可以作为一个扩展来实现（本章的做法）。
:::

::: interview 如果让你设计一个 Agent 的钩子系统，要考虑哪些问题？
- **事件**：覆盖会话、用户输入、工具调用前后、结束前等关键位置。
- **筛选**：按工具名匹配（精确、列表、正则）。
- **协议**：输入用 JSON（公共字段 + 事件字段）；输出用退出码表达最常见的“阻止”，用 JSON 表达精细决定。
- **决定的合并**：多个钩子意见不同时的优先级（deny > ask > allow）。
- **执行**：并行、去重、超时、超时后杀掉进程组。
- **失败语义**：出错时放行还是拒绝，能否按钩子配置。
- **与上下文的关系**：补充信息放在哪里，不破坏提示缓存，限制长度。
- **安全**：项目钩子需要信任；输入含模型生成的内容；钩子本身不是沙箱。
- **防止循环**：Stop 钩子的 `stop_hook_active`。
:::

::: interview 用 PreToolUse 钩子拦截危险命令，可靠吗？
不可靠，只能作为一层护栏。字符串匹配很容易绕过（换参数写法、换工具、用解释器执行），钩子默认还是出错放行。它适合防止善意的模型犯错和统一流程。真正的安全需要权限系统（哪些操作需要人确认）、沙箱（限制文件系统和网络的访问范围）和最小权限的凭据，钩子是在它们之上的补充。
:::

::: interview Stop 钩子有什么用？怎样防止它造成无限循环？
Stop 钩子在模型准备结束时运行，可以要求它继续，并给出原因，常用于质量门禁：测试没通过、lint 有错误、要求的文件还没生成，就不让结束。

防止无限循环：检查 `stop_hook_active`（这一轮本来就是钩子要求的），限制继续的次数，并且依据真实状态（运行测试、检查文件）做判断，而不是相信模型的自我报告。
:::

::: interview 钩子出错时应该放行还是拒绝？
取决于钩子的用途。Claude Code 的默认是放行（退出码 2 以外的失败、超时都不阻止），因为大多数钩子是辅助性的，不应该因为脚本问题让 Agent 无法工作。安全类的钩子则应该出错时拒绝：明确用退出码 2 表示拦截、配置 `onFailure: "block"`、避免依赖可能缺失的命令、只输出 JSON。Pi 的进程内扩展则相反：`tool_call` 处理函数抛出异常时阻止调用——同样的问题，两种设计给出了不同的默认值，面试时能说清楚各自的理由更重要。
:::
