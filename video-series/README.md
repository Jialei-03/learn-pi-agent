# Learn Pi Agent 短视频制作包

这套制作包把 18 章长文改写成 18 支竖屏知识短视频。视频沿用小红书图文的白底、黑色手写线条、橙色强调和 Mox 形象，但不会直接把卡片做成静态轮播：每个画面都要通过进场、局部聚焦、关系连线或状态变化解释一个概念。

## 已完成的内容

- 18 章逐章口播稿与分镜；
- 统一的画面、动画、字幕和录音规范；
- 第 1 章 1080 × 1920、80 秒无声样片及可继续编辑的本地动画工程；
- 每个分镜与现有小红书卡片一一对应，便于复用已经审核过的视觉内容。

首章本地样片位于：

```text
videos/learn-pi-agent-01-explainer/renders/learn-pi-agent-01-silent.mp4
```

`videos/` 保存本机渲染缓存和成片，不进入 Git。首章经过校验的动画源码保存在 `pilot-01/`，其余内容保存在本目录，便于长期维护和继续生成。

## 系列目录

| 集数 | 主题 | 无声分镜基准 |
| --- | --- | ---: |
| 01 | 从 LLM 到 Agent，再到 Harness | 80 秒 |
| 02 | 模型 API 与消息协议 | 82 秒 |
| 03 | Agent Loop、状态机与停止条件 | 82 秒 |
| 04 | Tools 与 Function Calling | 82 秒 |
| 05 | Context Engineering 与 Structured Output | 82 秒 |
| 06 | Session、Memory、Retrieval 与 Compaction | 82 秒 |
| 07 | MCP：Agent 与外部世界的协议 | 87 秒 |
| 08 | Skills 与 Prompt Templates | 87 秒 |
| 09 | Extensions、Plugins 与 Packages | 87 秒 |
| 10 | Workflow 与 Agent 的区别 | 87 秒 |
| 11 | Workflow Patterns | 87 秒 |
| 12 | Planning 与 Reasoning Patterns | 87 秒 |
| 13 | Agent SDK 与应用集成 | 87 秒 |
| 14 | Multi-Agent 与 A2A | 87 秒 |
| 15 | Sandbox、Code Agent 与 Computer Use | 87 秒 |
| 16 | Durable Execution 与 Human-in-the-loop | 87 秒 |
| 17 | Security、Guardrails 与 Governance | 87 秒 |
| 18 | Observability、Evaluation 与 Harness Engineering | 87 秒 |

表中秒数用于确定动画密度，不要求真人口播硬卡时长。按自然教学语速，成片预计约 90～125 秒；收到录音后再用真实停顿统一拉伸镜头、字幕和转场。

## 使用方式

1. 先读对应集数的分镜和连续口播稿；
2. 按完整口播稿录制一条音频，开头和结尾各保留约 0.5 秒静音；
3. 用真实音频重新取得逐字时间，再调整镜头切点和字幕；
4. 检查技术名词、字幕、安全区和手机端可读性；
5. 分别导出抖音版和小红书版，两者可以共用 1080 × 1920 主成片。

具体制作规则见 `PRODUCTION-GUIDE.md`。每一集的“事实锚点”用于防止短视频改写时丢失技术边界；详细论证和参考资料仍以对应课程章节为准。
