# 第 1 集动画样片工程

这是系列短视频的首章参考实现，规格为 1080 × 1920、30 fps、80 秒。工程使用独立 HTML 元素重建小红书知识卡片的构图，因此标题、关系线、状态节点、字幕和 Mox 可以分别运动，而不是整张 PNG 一起平移。

## 本地运行

```bash
pnpm install
pnpm check
pnpm dev
pnpm render
```

`prepare:assets` 会把仓库中的 Mox 标准设定图和本地安装的 GSAP 复制到 `public/`。这些生成文件、检查快照和 MP4 不进入 Git。

`check` 会在五个关键时间点检查 HTML、运行时、布局、运动和对比度；`render` 生成无声高清样片。拿到真人录音后，应先按真实逐字时间修改各段 `data-start` / `data-duration` 和字幕，再渲染最终版。
