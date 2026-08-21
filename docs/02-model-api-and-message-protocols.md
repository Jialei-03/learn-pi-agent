# 模型 API 与消息协议：OpenAI、Anthropic 与 Pi

> **本章问题：同一个 Agent Loop，为什么面对不同模型供应商时不能直接复用同一份请求和响应？**

第一章用 `model.generate(context)` 表示一次调用。现实中，模型服务通过 API 接收输入并返回输出；不同服务对消息、工具调用和工具结果的写法并不相同。

OpenAI 的 Chat Completions、Responses 和 Anthropic 的 Messages 都可以承载文本、工具调用和多轮上下文，下面用它们的请求与响应对照这些写法。

## 1. API、SDK、Runtime：三个不要混淆的层次

### 1.1 API 是通信契约

API 规定了：

- 请求发送到哪里；
- 请求体有哪些字段；
- 消息和内容块怎样表示；
- 工具如何声明；
- 响应如何表达文本、工具调用、错误和停止原因；
- 如何进行流式传输。

它解决的是“应用和模型服务如何通信”。

### 1.2 SDK 是语言绑定

SDK 把发送请求、认证和数据格式转换封装成 TypeScript、Python 或其他语言中的方法。例如：

```ts
const response = await client.responses.create({
  model: "your-model",
  input: "你好",
});
```

SDK 让调用更方便，但它不一定替你管理完整的 Agent Loop。是否自动执行工具、保存会话或重试，要看 SDK 的层级和配置。

### 1.3 Runtime / Harness 是更上层的运行系统

Runtime 需要在 API 之上处理：

- 多轮消息如何保存；
- Tool Call 如何分发；
- Tool Result 如何关联；
- 哪些响应可以继续；
- 哪些错误可以重试；
- 何时等待用户或结束运行。

所以，下面三段代码的抽象层次不同：

```text
fetch("/v1/responses")       // 直接使用 API
client.responses.create(...) // 使用 SDK
runAgent(...)                 // 使用 Agent Runtime / Harness
```

Runtime 使用 API 和 SDK 组织模型调用；工具的定义、参数校验和执行则由宿主程序负责。

## 2. 一次模型调用需要表达哪些事实

虽然供应商字段不同，但 Agent Runtime 通常需要从 API 中提取下面几类事实：

| 要表达的内容 | 作用 |
| --- | --- |
| 指令 | 系统或开发者希望模型遵守的规则 |
| 输入 | 用户消息、历史消息、文件、图片或其他内容 |
| 工具说明 | 模型可以请求哪些工具，以及参数格式（Schema） |
| 模型输出 | 文本、结构化内容、工具调用或拒答 |
| 调用编号 | 哪个工具结果对应哪个工具调用 |
| 结束原因 | 这一轮为什么结束或需要继续 |
| 用量统计 | token、缓存、延迟和费用等信息 |
| 流式事件 | 响应如何分成多次增量到达 |

可以用一个简化的数据流表示：

```text
输入 + 工具说明
          ↓
       模型 API
          ↓
文本 / 工具调用 / 错误 / 结束原因
          ↓
宿主程序
          ↓
运行状态
```

宿主程序需要从不同 API 的响应中读出这些共同信息，同时保留供应商提供的特殊能力。

## 3. OpenAI Chat Completions：以角色和消息为中心

Chat Completions 是较早、也仍然广泛使用的聊天接口。它以 `messages` 数组为中心，用角色和消息字段表示对话。[Create chat completion](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)

### 3.1 最小文本请求

下面用一个最小请求说明这些字段，模型名写成示例值：

```json
{
  "model": "your-model",
  "messages": [
    {
      "role": "system",
      "content": "你是一个简洁、准确的助手。"
    },
    {
      "role": "user",
      "content": "法国的首都是什么？"
    }
  ]
}
```

文本响应的核心部分可以理解为：

```json
{
  "id": "chatcmpl_example",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "法国的首都是巴黎。"
      },
      "finish_reason": "stop"
    }
  ]
}
```

这里需要注意两个层次：

- `message.content` 是模型生成的内容；
- `finish_reason` 是供应商对这一轮结束原因的描述。

Runtime 可以把它们转换成自己的 `text` 和 `stopReason`，但不能假设所有供应商都有同名字段。

### 3.2 在请求中声明函数工具

Chat Completions 使用 `tools` 声明函数工具。函数名、描述和参数 Schema 会成为模型选择工具时看到的接口说明：

```json
{
  "model": "your-model",
  "messages": [
    {
      "role": "user",
      "content": "北京现在天气怎么样？"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "查询某个城市的当前天气",
        "parameters": {
          "type": "object",
          "properties": {
            "city": {
              "type": "string",
              "description": "城市名称，例如北京"
            }
          },
          "required": ["city"],
          "additionalProperties": false
        },
        "strict": true
      }
    }
  ]
}
```

这里的 `parameters` 只是工具的输入契约，不是工具实现。模型可以选择调用它，但网络请求仍然由宿主程序执行。

### 3.3 Tool Call 与 Tool Result

当模型决定调用工具时，assistant message 可能包含 `tool_calls`：

```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_1",
      "type": "function",
      "function": {
        "name": "get_weather",
        "arguments": "{\"city\":\"北京\"}"
      }
    }
  ]
}
```

有三个细节值得记住：

1. `id` 用来关联后续工具结果；
2. `name` 告诉宿主查找哪个工具；
3. `arguments` 在这个协议形状中通常是 JSON 字符串，需要解析、校验，再交给执行器。

执行工具后，宿主要把 assistant 的 Tool Call 和一个 `tool` role 消息一起放回下一次请求：

```json
{
  "role": "tool",
  "tool_call_id": "call_1",
  "content": "{\"temperature\":\"28°C\",\"condition\":\"多云\"}"
}
```

`tool_call_id` 不是装饰字段。如果一轮有多个调用，Runtime 必须按 ID 关联结果，而不是假定返回顺序永远可靠。

### 3.4 `system` 与 `developer`

当前 OpenAI 文档对较新的模型还区分了 `developer` 消息和传统 `system` 消息。初学时可以先把它们理解为“比 user 指令优先级更高的应用指令”，但不要把供应商的角色层级直接当成通用 Agent 类型。

指令优先级、项目规则和用户输入之间的关系，会直接影响 Context 的组织方式。

## 4. OpenAI Responses：以输入和输出项目为中心

Responses API 是 OpenAI 当前推荐用于新项目的更完整接口。它仍然可以表达消息和工具调用，但组织方式从单一 `messages` 数组扩展为 `input` 与 `output` item。[OpenAI Developer Quickstart](https://platform.openai.com/docs/quickstart/make-your-first-api-request)、[Responses API Reference](https://developers.openai.com/api/reference/resources/responses/methods/create)

### 4.1 文本请求

最小调用可以直接使用字符串输入：

```json
{
  "model": "your-model",
  "input": "法国的首都是什么？"
}
```

如果要明确表达角色和内容类型，可以使用输入消息：

```json
{
  "model": "your-model",
  "instructions": "你是一个简洁、准确的助手。",
  "input": [
    {
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "法国的首都是什么？"
        }
      ]
    }
  ]
}
```

Responses 返回的是 output item 列表。文本消息可以写成：

```json
{
  "id": "resp_example",
  "status": "completed",
  "output": [
    {
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "法国的首都是巴黎。"
        }
      ]
    }
  ]
}
```

SDK 里的 `response.output_text` 是一个方便读取文本的聚合属性；在 Runtime 层，仍然应该理解底层的 output item，而不是只取一段字符串。

### 4.2 Responses 中的函数工具

Responses 的函数工具声明不再嵌套在 `function` 对象中，而是直接作为一个 function tool item：

```json
{
  "model": "your-model",
  "tools": [
    {
      "type": "function",
      "name": "get_weather",
      "description": "查询某个城市的当前天气",
      "parameters": {
        "type": "object",
        "properties": {
          "city": { "type": "string" }
        },
        "required": ["city"],
        "additionalProperties": false
      },
      "strict": true
    }
  ],
  "input": "北京现在天气怎么样？"
}
```

### 4.3 Function Call 与 Function Call Output

模型请求工具时，Responses 输出一个 `function_call` item：

```json
{
  "type": "function_call",
  "id": "fc_example",
  "call_id": "call_1",
  "name": "get_weather",
  "arguments": "{\"city\":\"北京\"}",
  "status": "completed"
}
```

执行工具后，宿主使用同一个 `call_id` 把结果作为下一个 input item 传回：

```json
{
  "type": "function_call_output",
  "call_id": "call_1",
  "output": "{\"temperature\":\"28°C\",\"condition\":\"多云\"}"
}
```

这和 Chat Completions 的 `tool_call_id` 作用相同，但承载方式不同：

```text
Chat Completions：assistant.tool_calls → role=tool
Responses：       output.function_call → input.function_call_output
```

Responses 还可以表达 OpenAI 托管的 Web Search、File Search、Code Interpreter 等工具。对于这些服务端工具，宿主参与的执行边界可能和自定义函数工具不同；Runtime 不能把所有工具都假设成“收到 JSON 后在本地执行”。

## 5. Anthropic Messages：以内容块为中心

Anthropic Messages API 也表达多轮消息和工具调用，但它把内容组织成 `content` block。工具调用和工具结果分别出现在 assistant 与 user 消息的内容块中，而不是使用单独的 `tool` role。[Claude Messages API](https://platform.claude.com/docs/en/api/go/messages)、[How tool use works](https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works)

### 5.1 最小文本请求

```json
{
  "model": "your-model",
  "max_tokens": 1024,
  "system": "你是一个简洁、准确的助手。",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "法国的首都是什么？"
        }
      ]
    }
  ]
}
```

Anthropic 的 `system` 通常是顶层字段，普通对话通过 `messages` 传入。消息的 `content` 可以是字符串，也可以是多个内容块；为了和工具、图片和文档保持一致，教程示例使用数组。

### 5.2 声明工具

Anthropic 的自定义工具以 `name`、`description` 和 `input_schema` 描述：

```json
{
  "name": "get_weather",
  "description": "查询某个城市的当前天气",
  "input_schema": {
    "type": "object",
    "properties": {
      "city": {
        "type": "string",
        "description": "城市名称，例如北京"
      }
    },
    "required": ["city"]
  }
}
```

参数 Schema 的作用仍然是约束工具输入，不是授权工具执行。模型的选择、宿主的校验和真正的副作用依然是三个不同步骤。

### 5.3 `tool_use` 与 `tool_result`

模型可能返回：

```json
{
  "stop_reason": "tool_use",
  "content": [
    {
      "type": "text",
      "text": "我先查询北京的实时天气。"
    },
    {
      "type": "tool_use",
      "id": "toolu_example",
      "name": "get_weather",
      "input": {
        "city": "北京"
      }
    }
  ]
}
```

宿主执行工具后，需要把 assistant 的完整响应和一个新的 user 消息放回下一次请求：

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_example",
      "content": "{\"temperature\":\"28°C\",\"condition\":\"多云\"}"
    }
  ]
}
```

这里的关键差异是：

```text
OpenAI Chat：tool result 是 role=tool 的消息
OpenAI Responses：tool result 是 function_call_output item
Anthropic：tool result 是 user 消息中的 tool_result block
```

Anthropic 文档还区分客户端执行的工具和服务端执行的工具。客户端工具需要应用驱动循环；服务端工具可能在 Anthropic 的基础设施中完成一部分循环。这个区别会直接影响宿主何时收到结果、是否需要提交 `tool_result`，以及停止原因如何解释。

### 5.4 `stop_reason` 不是单一的“成功/失败”字段

Anthropic 的 `stop_reason` 可能表示：

- `tool_use`：需要宿主处理工具调用；
- `end_turn`：模型认为这一轮完成；
- `max_tokens`：输出达到限制；
- `stop_sequence`：遇到停止序列；
- `refusal`：模型拒绝继续；
- 某些服务端工具场景下的暂停或继续信号。

Runtime 不应该把所有非 `tool_use` 的情况简单地当成“用户问题已正确回答”。结束原因需要被保留，供重试、展示、评测和错误处理使用。

## 6. 三种协议的对应关系

| Agent 需要的语义 | OpenAI Chat Completions | OpenAI Responses | Anthropic Messages |
| --- | --- | --- | --- |
| 高优先级指令 | `system` / `developer` message | `instructions` 或输入消息 | 顶层 `system` |
| 普通输入 | `messages` | `input` / input items | `messages` |
| 文本内容 | `message.content` | `output_text` 或 `output.message.content` | `content` 中的 `text` block |
| 工具声明 | `tools[].function` | `tools[]` function item | `tools[]` with `input_schema` |
| 工具调用 | `assistant.tool_calls[]` | `output[].type = function_call` | assistant `tool_use` block |
| 调用标识 | `tool_calls[].id` | `function_call.call_id` | `tool_use.id` |
| 工具结果 | `role = tool` | `function_call_output` | user `tool_result` block |
| 结束信息 | `finish_reason` | output item / response status | `stop_reason` |
| 流式传输 | chat completion chunks | typed response events | SSE content block events |

这张表不是为了把三个 API 强行压成一个格式，而是帮助我们找出不同接口之间需要转换的字段。

## 7. 适配层：Pi 如何连接不同模型 API

如果 Agent Runtime 直接读取某一个供应商的字段，循环就会被供应商差异绑住：

```ts
if (provider === "openai") {
  // 读取 choices[0].message.tool_calls
} else if (provider === "anthropic") {
  // 遍历 content 中的 tool_use block
}
```

短期可以运行，长期会让每个工具、事件和错误分支都带着供应商条件。把这些字段转换成运行循环能理解的统一格式，这段代码叫 Provider Adapter（供应商适配层）：

```text
OpenAI Chat / Responses / Anthropic Messages
                  ↓
       供应商适配层（Provider Adapter）
                  ↓
       统一消息 / 工具调用 / 流式事件
                  ↓
             Agent Runtime
```

Pi 把这部分能力放在 `pi-ai` 中，当前支持 `anthropic-messages`、`openai-completions`、`openai-responses` 等接口类型。对于不符合现有格式的服务，Pi 也可以通过扩展机制注册自定义的供应商接口。[Pi Providers](https://pi.dev/docs/latest/providers)、[Pi Custom Providers](https://pi.dev/docs/latest/custom-provider)

![不同模型协议经过 Provider Adapter 统一](../assets/model-api-illustrations/01-provider-adapter.png)

### 7.1 统一共同语义，而不是抹平所有差异

下面的类型只保留运行循环需要的两种结果：文本和工具调用。

```ts
type ToolCall = {
  id: string;
  name: string;
  arguments: unknown;
};

type ToolResult = {
  callId: string;
  output: unknown;
  isError?: boolean;
};

type ModelTurn =
  | {
      kind: "text";
      text: string;
      stopReason?: string;
    }
  | {
      kind: "tool_calls";
      calls: ToolCall[];
      stopReason?: string;
    };
```

这个类型能让 Agent Loop 不必知道 `tool_calls`、`function_call` 和 `tool_use` 的具体字段。但一个真实适配层还需要保留：

- 原始供应商和模型名称；
- 原始响应或事件 ID；
- 用量、缓存和成本信息；
- 思考、推理、拒答等供应商特性；
- 供应商特有的错误和结束原因。

因此，适配器的原则是：

```text
统一 Runtime 需要的共同语义
保留供应商特有的信息
```

### 7.2 Pi 的自定义供应商接口

当服务使用代理、私有部署、OAuth/SSO 或非标准流式协议时，Pi 可以通过扩展机制注册自定义供应商接口。它适合代理、私有端点、自定义认证和自定义流式 API。[Pi Custom Providers](https://pi.dev/docs/latest/custom-provider)

这说明 Pi 的扩展机制不仅可以增加命令，也可以扩展 Harness 与模型服务之间的连接方式。

## 8. 流式响应（Streaming）：响应不是一次性字符串

用户界面通常希望边生成边显示，因此三个 API 都提供流式事件。但流式事件不是最终消息的简单切片，而是一种需要状态累积的协议。

### 8.1 文本流

文本流大致经历：

```text
开始一个响应
  ↓
收到一小段文本（delta）
  ↓
不断追加到当前内容块
  ↓
收到完成事件
  ↓
形成最终的助手消息（Assistant Message）
```

### 8.2 工具参数流

工具参数也可能以增量字符串到达：

```text
"{ \"ci"
"ty\": \"北京\" }"
```

Runtime 不能在收到第一段 `"{ \"ci"` 时就执行工具。它至少需要等待参数完成，再进行 JSON 解析、Schema 校验和执行策略检查。

### 8.3 事件与消息的区别

一个流式事件可能只表达“参数增加了几个字符”，而一个完整消息才表达“这次 Tool Call 的最终参数是什么”。因此要区分：

```text
Stream Event = 传输过程中的增量事实
Message      = 可以写入上下文的完整交互记录
```

这也是 Pi 的模型适配层和 Agent 运行层需要分别处理流式事件、完整消息和工具执行事件的原因。UI 可以消费增量事件，但 Agent Loop 需要基于完整、可校验的语义推进。

![流式增量完成后与调用 ID 关联](../assets/model-api-illustrations/02-stream-and-id.png)

## 9. 常见的协议误读

### 9.1 把 `arguments` 当成已经校验过的对象

OpenAI 的某些工具调用形状会把参数作为 JSON 字符串返回；即使 SDK 帮你解析了，也不能跳过 Schema 和执行策略校验。

### 9.2 把 Tool Call 当成工具执行

三种 API 都遵循一个核心边界：模型产生结构化请求，宿主或供应商的工具基础设施执行动作，结果再回到模型上下文。请求对象本身没有副作用。

### 9.3 只看文本，不保存结构化内容

如果 Runtime 只读取最终文本，就会丢失 Tool Call、拒答、停止原因、usage、引用和事件信息，因而不能可靠地继续循环或评估。

### 9.4 用数组顺序代替调用 ID

并行工具调用、重试和服务端工具都可能让返回顺序变得复杂。应始终使用 `call_id`、`tool_call_id` 或 `tool_use_id` 进行关联。

### 9.5 把所有工具都看成客户端工具

客户端工具需要宿主执行并回传结果；服务端工具可能在供应商基础设施中运行。工具的执行位置会改变权限、延迟、计费、审计和循环边界。

### 9.6 把 Provider Adapter 当成“无损翻译器”

适配器能统一核心循环需要的部分，但不应该抹掉供应商特有的能力。否则 Runtime 虽然看起来统一了，实际却失去了推理过程、服务端工具、缓存、拒答和错误诊断等重要信息。

## 本章小结

- API 是模型服务与应用之间的通信契约，SDK 是语言层包装，Runtime/Harness 负责更高层的循环与状态；
- Chat Completions 以 role message 和 `tool_calls` 为中心；Responses 以 input/output item 和 `function_call` 为中心；Anthropic Messages 以 content block、`tool_use` 和 `tool_result` 为中心；
- 三种 API 都需要表达工具声明、调用标识、工具结果和停止原因，但字段位置和消息形状不同；
- Streaming Event 是传输增量，完整 Message 才能进入稳定的 Agent 状态；
- Provider Adapter 应统一 Runtime 需要的共同语义，同时保留 Provider 特有信息；
- Pi 的 `pi-ai` 正是吸收这些 API、消息、工具和流式事件差异的边界层。

## 与经典研究的连接

ReAct 把“推理—行动—观察”作为交替过程，是理解 Agent Loop 的经典研究背景；Toolformer 讨论模型如何学习选择工具、生成参数并吸收结果。但论文中的方法并不等于某个供应商 API：API 定义的是可执行的通信契约，Runtime 才负责把契约接入真实工具和状态。[ReAct](https://arxiv.org/abs/2210.03629)、[Toolformer](https://arxiv.org/abs/2302.04761)、[论文索引](../references/papers.md)
