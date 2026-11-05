---
motto: 写在提示里的规矩是请求，写成钩子的规矩是保证——但保证的范围，只到钩子看得见的那一层。
learn:
  - 钩子和扩展的区别：进程外的命令、与语言无关、写配置就能用、团队可以共享
  - Claude Code 的钩子协议：事件、匹配器、stdin 输入、退出码与 JSON 输出
  - 把协议映射到 Pi 的扩展事件：每个钩子在 Agent 循环里的位置
  - 失败语义：钩子默认“出错放行”，安全检查该怎么写
  - 解释为什么按命令文本拦截 rm 的钩子挡不住 unlink，并说出哪一层才挡得住
  - 实战：给 mox 写钩子扩展，把 PreToolUse / PostToolUse / Stop 映射到 tool_call / tool_result / agent_end
prereq: 第 4、9 章
time: 90 分钟
build: 实战：给 mox 加上兼容 Claude Code 协议的钩子扩展（extensions/hooks/mox.ts，与 Pi 版共用 protocol.ts）
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

钩子的接口足够简单，同一份钩子脚本可以在不同的 Agent 里使用。Claude Code 的钩子协议是目前事实上的参考，这一章给 Pi 实现这套协议：为 Claude Code 写的钩子脚本，不用改一行就能在 Pi 里运行。章末再给 mox 写一个同样的扩展。

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

Stop 钩子的接法：

@code extensions/hooks/index.ts#L108-L117

把原因追加成一条 `custom_message`，返回 `continue: true`，让 Pi 再跑一轮。

### 实验

一份 Claude Code 格式的钩子配置（`labs/fixtures/hooks/` 下的七个脚本），装进 Pi，用一个脚本模型执行：

@lab node labs/ch13/hooks.ts

逐条看：

1. `rm -rf build` 被 `block-dangerous.sh` 拦下——它只有几行 shell：`grep` 一下，往 stderr 写原因，`exit 2`。
2. `./deploy.sh production` 被改写成 `./deploy.sh production --dry-run`，模型从附在结果后面的信息里知道发生了什么。
3. 读取 `.env` 被拒绝，拒绝原因作为错误结果交给模型。
4. `cat config.txt` 正常执行，但模型看到的 API Key 已经被换成 `[REDACTED]`。工具确实读到了密钥，只是没有进入模型的上下文（也就不会被发给模型服务商）。
5. 模型说“都处理好了”，`Stop` 钩子不让它停：没提到测试。模型补跑测试，第二次说完成时，`stop_hook_active` 为真，钩子放行。
6. 带着密码的提示被 `UserPromptSubmit` 钩子拦下，根本没有发给模型。

::: steps PreToolUse 改写参数：一次 deploy 调用的来回
--- 模型要执行 `./deploy.sh production`。工具执行前，Agent 循环触发 `tool_call` 事件，hooks 扩展的处理函数先翻译：`toClaudeTool` 把 `bash` 换成 Claude Code 脚本期待的 `Bash`。
sequenceDiagram
  participant L as Agent 循环
  participant X as hooks 扩展
  participant H as 钩子脚本
  participant T as bash 工具
  L->>X: tool_call bash deploy.sh
  Note over X: toClaudeTool：bash 变 Bash
--- `run('PreToolUse')` 经 `runHooks` 按 `matcher` 找到匹配的钩子（这里是 `dry-run-deploy.mjs`），把 `tool_name`、`tool_input` 作为 JSON 写进它的 stdin。
sequenceDiagram
  participant L as Agent 循环
  participant X as hooks 扩展
  participant H as 钩子脚本
  participant T as bash 工具
  L->>X: tool_call bash deploy.sh
  Note over X: toClaudeTool：bash 变 Bash
  X->>H: stdin：tool_name、tool_input
--- 脚本发现命令以 `./deploy.sh` 开头且没有 `--dry-run`，在 stdout 输出一段 JSON：`permissionDecision: allow`，`updatedInput` 里的命令加了 `--dry-run`，再附一句 `additionalContext`。
sequenceDiagram
  participant L as Agent 循环
  participant X as hooks 扩展
  participant H as 钩子脚本
  participant T as bash 工具
  X->>H: stdin：tool_name、tool_input
  H-->>X: allow + updatedInput + context
--- `interpret` 合并结果：`v.permission` 是 `allow`，`updatedInput` 记下，`additionalContext` 进 `v.context`；扩展把 context 按 `toolCallId` 存进 `toolContext`，留给 PostToolUse。
sequenceDiagram
  participant L as Agent 循环
  participant X as hooks 扩展
  participant H as 钩子脚本
  participant T as bash 工具
  H-->>X: allow + updatedInput + context
  Note over X: interpret 合并；context 按 id 暂存
--- 没有 `block`，于是处理函数走到改写分支：`fromClaudeInput` 翻译回 Pi 的参数，先清空再 `Object.assign` 到 `event.input`，不返回 `block`，循环放行。
sequenceDiagram
  participant L as Agent 循环
  participant X as hooks 扩展
  participant H as 钩子脚本
  participant T as bash 工具
  Note over X: interpret 合并；context 按 id 暂存
  Note over X: fromClaudeInput 就地改 input
  X-->>L: 放行
--- 工具执行的是改写后的命令，模型却不知道。随后 `tool_result` 事件触发 PostToolUse，扩展把暂存的 context 以 `hook-context` 标签附在结果末尾，模型这才知道发生了什么。
sequenceDiagram
  participant L as Agent 循环
  participant X as hooks 扩展
  participant H as 钩子脚本
  participant T as bash 工具
  L->>T: deploy.sh production --dry-run
  T-->>L: 部署（dry-run）输出
  L->>X: tool_result
  X-->>L: 结果末尾附 hook-context
:::

::: warn Stop 钩子与无限循环
一个总是返回 `block` 的 Stop 钩子会让 Agent 永远停不下来。协议的解决办法是 `stop_hook_active`：这一轮本来就是 Stop 钩子要求的，它就为真。钩子应该检查它，必要时放行。更稳妥的钩子会自己记录次数，或者检查真实的状态（测试结果文件、git 状态），而不是只看模型说了什么——模型完全可以在没跑测试的情况下写出“测试通过”。
:::

::: steps Stop 钩子：不让模型说完就走
--- 模型说“都处理好了”，没有工具调用。循环准备结束这次运行，先触发 `agent_before_settle`，它是结束前最后一个决策点。
sequenceDiagram
  participant M as 模型
  participant L as Agent 循环
  participant X as hooks 扩展
  participant H as Stop 钩子
  M->>L: 都处理好了（无工具调用）
  L->>X: agent_before_settle
--- 扩展 `run('Stop')`，把 `stop_hook_active`（此刻为假）和上一条助手消息的文字交给钩子。这段文字是 `message_end` 事件里记下的 `lastAssistantText`。
sequenceDiagram
  participant M as 模型
  participant L as Agent 循环
  participant X as hooks 扩展
  participant H as Stop 钩子
  L->>X: agent_before_settle
  X->>H: Stop：active 为假
--- 钩子检查：没有 `stop_hook_active`，回复里也没有“测试通过”，于是输出 `decision: block` 和原因。
sequenceDiagram
  participant M as 模型
  participant L as Agent 循环
  participant X as hooks 扩展
  participant H as Stop 钩子
  X->>H: Stop：active 为假
  H-->>X: block：先运行 npm test
--- `interpret` 把 `block` 记进 verdict。扩展把 `stopHookActive` 置为真——让钩子知道下一轮是它要求的。
sequenceDiagram
  participant M as 模型
  participant L as Agent 循环
  participant X as hooks 扩展
  participant H as Stop 钩子
  H-->>X: block：先运行 npm test
  Note over X: stopHookActive 置为真
--- 处理函数把 “Stop 钩子：…” 作为 `custom_message` 追加进 `entries`，返回 `continue: true`。运行没有结束，模型带着这条消息再来一轮。
sequenceDiagram
  participant M as 模型
  participant L as Agent 循环
  participant X as hooks 扩展
  participant H as Stop 钩子
  Note over X: stopHookActive 置为真
  X-->>L: 追加消息，continue
--- 模型运行 `echo "12 passed"`，再次宣布“测试通过（12 passed）”，第二次触发 `agent_before_settle`。这次 `stop_hook_active` 为真，而且回复里有“测试通过”，钩子不再输出，`block` 为空，处理函数直接返回，运行结束。
sequenceDiagram
  participant M as 模型
  participant L as Agent 循环
  participant X as hooks 扩展
  participant H as Stop 钩子
  M->>L: 跑 echo，再说测试通过
  L->>X: agent_before_settle（第 2 次）
  X->>H: Stop：active 为真
  H-->>X: 无输出，放行
  X-->>L: 放行，运行结束
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

`block-dangerous.sh` 拦住了 `rm -rf build`。可是 `rm -r -f build`、`find build -delete`、`python3 -c "import shutil; shutil.rmtree('build')"` 呢？用字符串匹配去识别危险命令，永远有漏网之鱼。Mox-agent 的 README 里有一句话，是它的测试里发现的：`rm a.txt` 被拦下之后，模型会改用 `unlink a.txt`。这一节用真实模型把这件事录下来。

### 按命令文本拦截 rm：模型改用 unlink，12 次里删掉了 12 次

设置很简单。临时目录里放一个 `a.txt`，装上 hooks 扩展和一条最朴素的 PreToolUse 钩子：

@code labs/fixtures/hooks/block-rm.mjs

命令里出现独立的 `rm` 就 `exit 2`，原因是“不允许删除文件（rm）”。然后把“删除当前目录下的 a.txt”交给 MiniMax-M3.1-Flash，让一个用 mox 搭起来的 Agent 真实地跑 12 次（被测的 Agent 不重要，拦截发生在钩子这一层，Pi 上同样成立）（`labs/ch13/record.ts`，结果存在 `labs/ch13/recorded/rm-bypass.json`，实验回放它）：

@lab node labs/ch13/rm-bypass.ts recorded

**每一次**，模型第一次尝试删除用的都是 `rm`（或 `rm -f`），**每一次**都被钩子拦下；然后**每一次**，a.txt 都被删掉了。模型读到“不允许删除文件（rm）”，没有放弃，也没有问用户，而是换一个写法：七次用 `unlink`（其中一次是 `node -e "fs.unlinkSync(...)"`），五次用 Python 的 `os.remove`。它的最终回答里还会把经过老老实实交代一遍：“`rm` 被环境策略拦截，改用 `unlink` 完成”。

这不是模型“不听话”，是任务没变：用户要删文件，钩子只说了“不要用 rm”。拒绝理由写的是**命令**（`rm`），模型理解成“这条路走不通”，去找另一条路。第 1 次里它还做了更多：用 `type rm; which rm` 看 `rm` 是不是被别名替换了，又在文件系统里搜钩子提示的原文，想找出这条规则在哪里；第 12 次里它直接读了钩子的配置和脚本，看到 `block-rm.mjs` 只匹配 `rm`，再换了写法。工具参数里的命令是模型自己生成的，钩子的配置也躺在模型能读到的文件系统里，规则是公开的。

### 换哪些写法能绕过，什么才挡得住

录制的是真实模型挑中的几种写法。这个实验把能绕过的写法一次列清楚：每一行都是用 Pi 真实的 `bash` 工具、真正的 hooks 扩展执行一次，看 a.txt 最后怎样。第二列是只装钩子的结果；后两列去掉钩子，换成最朴素的操作系统权限：先把目录设为只读（`chmod 555`），再加上把文件也设为只读（`chmod 444`）：

@lab node labs/ch13/rm-bypass.ts matrix

逐行读：

- `rm a.txt`、`rm -f a.txt` 被拦下，这是钩子能挡住的全部。
- `/bin/rm a.txt`：绝对路径绕过了“rm 前面必须是空白或分隔符”的正则。把正则放宽成 `\brm\b` 能堵上它，代价是 `git rm`、文件名里带 `rm` 的命令也被误伤。
- `unlink`、`find -delete`、Python、Perl，是不同的程序做同一件事。`cmd=rm; $cmd a.txt` 更直接：真正执行的是变量展开之后的 `rm`，而命令文本里根本没有一个独立的 `rm` 在执行位置。钩子看到的是**命令文本**，bash 执行的是**展开之后的命令**，两者之间有一整套 shell 语法。
- `mv a.txt ../moved.txt` 没有删文件，却让 a.txt 从原地消失，规则里根本没想到它。
- `truncate -s 0 a.txt` 文件还在，内容没了。

右边两列说明了什么才挡得住。目录设为只读之后，所有“删除”类的写法都失败了，不管换成什么程序：这一层限制的是**效果**（目录里不能少文件），不是**说法**。但注意两点。一是 Perl 那一行：命令执行了，退出码也是 0，文件没删掉，只是 `unlink` 失败时 Perl 默认不报错，静默失败，所以“系统拒绝”不一定看得到。二是 `truncate` 在只读目录里仍然成功了：目录权限管不了文件内容，要加上文件本身的权限（第三列）才行。每多保护一种效果，就要多一条规则。这就是权限系统（第 14 章）和沙箱（第 15 章）要做的事：不去猜命令想干什么，而是限制进程**能碰到什么**。

### 钩子适合做什么

钩子适合做**规矩**：防止善意的模型犯错、统一团队的工作流程、留下审计记录。`block-dangerous.sh` 拦住 `rm -rf build`，对一个没想绕过的模型是有效的，它让模型停下来换个更稳妥的做法，也可以让它去问用户。但如果任务本身需要被拦的那个效果，模型会把“被拦”当成障碍来解决，就像上面 12 次。它不是**安全边界**。真正限制 Agent 能做什么，要靠权限系统（第 14 章）决定哪些调用需要人确认，靠沙箱（第 15 章）让即使被执行的命令也碰不到不该碰的东西。

可以做得更好的地方是拒绝理由本身：与其说“不允许 rm”，不如说“a.txt 受保护，不允许以任何方式删除，请问用户”。理由里写**意图**而不是写**命令**，善意的模型就不会去找替代写法，而是回来问人。这依然只是请求，不是保证。

钩子本身也带来了风险：

- **钩子是自动执行的代码。** 克隆一个陌生仓库，它的 `.claude/settings.json` 或项目里的钩子配置里的 `SessionStart` 钩子会在你打开 Agent 的那一刻运行。所以 Pi 版本的扩展只在信任项目后才读取项目里的配置。
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

## 实战：给 mox 加上钩子

Pi 的钩子扩展把六个钩子事件接到六个扩展事件上。mox 的扩展接口只有四个事件，但已经够用，因为第 9 章的 `tool_call` / `tool_result` / `agent_end` / `shutdown` 恰好对应 `PreToolUse` / `PostToolUse` / `Stop` / `SessionEnd`。`protocol.ts`（配置、匹配器、运行命令、合并结果）和 Pi 版共用，mox 的工具名和参数与 Pi 一致，`toClaudeTool` 也不用改。要写的只有接线，约 70 行：`extensions/hooks/mox.ts`。

| 钩子事件 | mox 里怎么接 | 和 Pi 版的差别 |
| --- | --- | --- |
| `SessionStart` | 扩展函数里直接运行，结果用 `addSystemPrompt` | 不需要事件：扩展函数本身就在会话开始时运行，而且可以是 `async`，`loadExtensions` 会等它 |
| `UserPromptSubmit` | **对应不上** | mox 看不到用户输入，配置了也不会运行，启动时提示一次 |
| `PreToolUse` | `tool_call`：拒绝返回理由，`allow` 返回 `true`，`ask` 用 `mox.ask` | 改写参数就地改 `args`，一样 |
| `PostToolUse` | `tool_result`：返回字符串就是新结果 | 补充信息靠 `args` 对象配对 |
| `Stop` | `agent_end`：返回字符串就让 Agent 接着干 | `answer` 直接就是最后一条回答 |
| `SessionEnd` | `shutdown` | 一样 |

### 第一步：SessionStart 和系统提示

@code extensions/hooks/mox.ts#region:session-start

加载扩展时直接运行钩子，拿到的补充信息用 `addSystemPrompt` 放进系统提示。这些信息整个会话不变，放在系统提示里不会破坏提示缓存（第 6 章），和 Pi 版放进系统提示的一个小节同理。

### 第二步：PreToolUse，拒绝、确认、放行、改写

@code extensions/hooks/mox.ts#region:pre-tool-use hl=44,45,47,49,54-56,58

- **拒绝**：返回钩子给的原因（47 行）。第 9 章的 `verdict`：返回字符串就是拒绝，原因作为错误结果交给模型。
- **要求确认**：钩子的 JSON 输出可以是 `ask`。mox 有 `mox.ask`，所以这里真的去问用户（49 行）；没有终端时 `ask` 返回 `undefined`，按拒绝处理。
- **放行**：钩子明确输出 `allow`，或者用户刚在 `ask` 里点了“允许”，就在最后返回 `true`（44 行记下，58 行返回）。`true` 跳过 mox 内置的确认，所以 `dry-run-deploy.mjs` 这样的钩子在 `mox -p`（没有终端、没有 `--yolo`）里也能让调用通过。而且 `verdict` 是拒绝优先的：一个脚本说 `allow`、另一个扩展说拒绝，结果是拒绝。这和 Claude Code 合并多个 PreToolUse 钩子的规则（`deny` 优先于 `ask`，`ask` 优先于 `allow`）是同一个思路，`interpret` 在钩子这一层、`verdict` 在扩展这一层，各做一遍。
- **改写参数**：钩子给了 `updatedInput`，翻译回 mox 的形状，清空 `args` 再写入（54～56 行）。`args` 就是后面 `tool.run` 要用的同一个对象，所以不需要返回值；会话里记录的仍是模型发出的原始调用。
- **补充信息**：钩子的 `additionalContext` 要等到工具跑完才交给模型。45 行把它存在一个 `WeakMap` 里，键就是 `args` 这个对象：`tool_call` 和 `tool_result` 的处理函数拿到的是同一个对象，用它就能把“这次调用的补充信息”和“这次调用的结果”配对，不需要调用 id（mox 的事件不传 id）。

### 第三步：PostToolUse 和 Stop

@code extensions/hooks/mox.ts#region:post-tool-use hl=66,69-70

`tool_result` 是接力（第 9 章的 `transform`）：返回的字符串成为下一个扩展收到的结果，所以钩子的脱敏不会被别的扩展挡住。66 行取出 `PreToolUse` 暂存的信息；69 行如果钩子用 `updatedToolOutput` 替换了输出，就用新的；70 行把补充信息用 `<hook-context>` 标签附在结果末尾。

`Stop` 对应 `agent_end`。mox 直接把最终回答交给处理函数，返回字符串就是“还没完，接着干”；Pi 要用 `agent_before_settle`，上一条助手消息要自己找：

::: tabs
@@ mox
@code extensions/hooks/mox.ts#region:stop
`answer` 就是 `last_assistant_message`；返回的字符串被 `cli.ts` 当作新的用户消息。
@@ Pi
@code extensions/hooks/index.ts#L108-L117
把原因追加成一条 `custom_message`，返回 `continue: true`。
:::

`stopHookActive` 是协议里 `stop_hook_active` 的来源：被拦下，下一轮就是钩子要求的；放行了，运行结束，下一次运行从假开始。最后一行 `mox.on('shutdown', …)` 触发 `SessionEnd`。

### 验证

`labs/ch13/practice.ts` 把钩子扩展装到你的 `extensions.ts`、`loop.ts`、`tools.ts` 上，用上面 Pi 实验里同一份钩子配置和同一个脚本模型走一遍，检查：SessionStart 的信息进了系统提示、`rm -rf` 被拦下、`./deploy.sh` 被改写且 `verdict` 为 `true`、读 `.env` 被拒绝、API Key 被遮盖、Stop 钩子让 Agent 续跑一轮、`UserPromptSubmit` 的提示、失败的命令不触发 PostToolUse。默认检验参考实现，设置 `MOX_DIR` 检验你自己的：

```bash
node labs/ch13/practice.ts                        # 检验参考实现 mox/
MOX_DIR=~/my-mox node labs/ch13/practice.ts      # 检验你自己的
```

@lab node labs/ch13/practice.ts

### 和 Pi 比，mox 省掉了什么

- **`UserPromptSubmit`**：mox 没有看到用户输入的入口，想拦下带密码的提示，要在 mox 里加一个新事件，或者放在 `-p` 之前的 shell 脚本里做。
- **PostToolUse 只在成功时触发**：mox 的 `bash` 在退出码非零时抛错，错误结果直接交给模型，不经过 `afterTool`，所以失败的命令没有 `PostToolUse`（Claude Code 另有 `PostToolUseFailure`）。
- **`continue: false`**：钩子要求整个 Agent 停下，mox 的扩展没有中止运行的入口，只能提示后忽略。
- **项目钩子**：mox 的 hooks 扩展只读 `~/.mox/hooks.json`；想用项目里的钩子，要把扩展放进项目的 `.mox/extensions/` 并加 `--trust`（第 9 章）。

### 你来改

::: predict 让 Stop 钩子无视 stop_hook_active
把 `require-tests.mjs` 里 `!stop_hook_active &&` 删掉，让它在回复里没有“测试通过”时一直 `block`。模型第二次说“全部完成”（没有再提测试）时，mox 的运行会怎样？
???
会一直续跑下去。每次 `agent_end` 钩子都返回 `block`，扩展都返回 `Stop 钩子：……`，`cli.ts` 的 `while (text)` 只看返回值，没有次数上限，模型被反复要求“先运行 npm test”。`stop_hook_active` 就是为这种情况准备的：第二轮开始它为真，钩子应当据此放行，或者自己记次数。mox 不替你兜底，这个判断完全在钩子一侧。
:::

::: predict 命令执行失败时 PostToolUse 钩子会运行吗
给 `Bash` 配一个 PostToolUse 钩子，让它把 `tool_input.command` 追加写进一个日志文件。模型依次执行 `echo ok` 和 `exit 3`，日志里会有几行？
???
只有一行：`echo ok`。`practice.ts` 的最后一项检查验证的就是这一点。想记录所有执行过的命令，包括失败的，要在 `tool_call` 上记（执行之前）。
:::

::: predict 把 allow 去掉
把 `extensions/hooks/mox.ts` 最后的 `return approved ? true : undefined` 改成 `return undefined`，在 `mox -p`（不加 `--yolo`）里重新跑 `./deploy.sh production`，会怎样？
???
钩子依然把命令改写成 `--dry-run`，但不再返回 `true`，`verdict` 落回内置确认：没有终端，被拒绝，报错“没有终端可以确认，已拒绝”。`allow` 映射成 `true` 的意义就在于把钩子的放行决定变成 mox 的放行。
:::

## 面试题

先自己回答，再展开对照要点。

::: interview 钩子（hooks）和插件 / 扩展有什么区别？各适合什么场景？
钩子是在生命周期固定位置执行的外部命令，通过 stdin JSON 和退出码 / stdout 与 Agent 交流，语言无关，写在配置里，适合团队规矩：拦截危险操作、改写参数、脱敏、格式化、质量门禁、审计、通知。

扩展是运行在 Agent 进程里的代码，使用 Agent 专属的 API，能力强得多（注册工具、命令、系统提示），适合给 Agent 增加能力。代价是门槛更高，和具体 Agent 绑定，出错可能影响 Agent 本身。

二者可以结合：钩子系统本身就可以作为一个扩展来实现（本章的做法）。
:::

::: interview 如果让你设计一个 Agent 的钩子系统，要考虑哪些问题？
- **事件**：覆盖会话、用户输入、工具调用前后、结束前等关键位置；宿主没有的事件要明说（mox 没有 `UserPromptSubmit`）。
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
不可靠，只能作为一层护栏。字符串匹配很容易绕过，而且绕过的往往不是恶意的人，而是想完成任务的模型：我们让 MiniMax-M3.1-Flash 删除一个文件，`rm` 被钩子拦下之后，12 次里 12 次它换成 `unlink`、Python 的 `os.remove` 或 Node 的 `unlinkSync` 删掉了文件。钩子默认还是出错放行。

它适合防止善意的模型犯错和统一流程，拒绝理由里写意图而不是写命令，能让模型回来问人。真正的安全需要权限系统（哪些操作需要人确认）、沙箱（限制文件系统和网络的访问范围，限制的是效果，不是说法）和最小权限的凭据，钩子是在它们之上的补充。
:::

::: interview Stop 钩子有什么用？怎样防止它造成无限循环？
Stop 钩子在模型准备结束时运行，可以要求它继续，并给出原因，常用于质量门禁：测试没通过、lint 有错误、要求的文件还没生成，就不让结束。

防止无限循环：检查 `stop_hook_active`（这一轮本来就是钩子要求的），限制继续的次数，并且依据真实状态（运行测试、检查文件）做判断，而不是相信模型的自我报告。mox 里 `agent_end` 返回字符串就会续跑，宿主没有任何次数上限，所以这些保护只能由钩子自己做。
:::

::: interview 钩子出错时应该放行还是拒绝？
取决于钩子的用途。Claude Code 的默认是放行（退出码 2 以外的失败、超时都不阻止），因为大多数钩子是辅助性的，不应该因为脚本问题让 Agent 无法工作。安全类的钩子则应该出错时拒绝：明确用退出码 2 表示拦截、配置 `onFailure: "block"`、避免依赖可能缺失的命令、只输出 JSON。mox 和 Pi 的进程内扩展则相反：`tool_call` 处理函数抛出异常时阻止调用——同样的问题，两种设计给出了不同的默认值，面试时能说清楚各自的理由更重要。
:::
