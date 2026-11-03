# 工程解读方法与工具

本系列按「源码定位 → 职责和状态 → 调用链 → 失败边界 → 可重复验证」组织。每个项目固定自己的源码版本；图表用于导航，不能把主题关系写成未经证明的函数调用。

## 已配备的 Skill

Star 为 2026-11-03 GitHub API 快照，反映仓库受关注程度，不代表每个 Skill 的质量保证。

| 项目 | Star 快照 | 使用内容 | 用途 |
| --- | ---: | --- | --- |
| [Egonex-AI/Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) | 90,132 | understand, understand-explain | 源码架构、节点邻域和调用关系解读 |
| [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) | 50,681 | json-canvas | 可编辑思维导图 |
| [softaworks/agent-toolkit](https://github.com/softaworks/agent-toolkit) | 2,618 | mermaid-diagrams | 工程流程图与 GitHub 图示语法 |

安装到 Codex 的个人 skills 目录；Understand Anything 的配套仓库和 core 已准备并通过模块导入检查。没有为源码仓库开启自动更新 Hook，也不依赖额外收费模型。Skill 下轮可用；以后可直接要求“用 understand 分析这个模块”或“用 json-canvas 更新这张工程导图”。

## 把图画成证据入口

一份 `engineering/map.json` 生成三种产物：网页工程地图、可编辑 `engineering/architecture.canvas`、GitHub 原生 Mermaid 说明。网页可选主题、缩放并点击节点打开源码。

- 根节点记录研究对象和版本。
- 第一层是阅读主题，边的含义是分类。
- 叶节点连接真实源码文件和行号，边的含义是实现入口。
- 只有检查调用语句后，才在专门的调用图中使用 calls 边。
- feature 条件、声明占位和未做运行验证的边界，在正文中单独解释。

## 更新方式

```bash
npm run map:generate
npm run check
npm run build
```

导图生成器会核对源码提交、文件、函数锚点或行号，并验证 Canvas ID 唯一与边引用有效。它验证定位一致性，不能自动证明所有解释正确；改机制时仍需阅读调用者和失败路径。
