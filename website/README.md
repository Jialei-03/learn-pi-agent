# 课程网站

网站内容由仓库里的 `docs/` 和 `references/` 生成；修改 Markdown 后需要重新构建，网站不会自动跟随 GitHub 更新。

## 本地构建和预览

需要 Node.js 22.19 或更新版本、Python 3 和 `markdown-it-py`、`beautifulsoup4`、`Pillow`、`Pygments`：

```bash
python3 -m pip install markdown-it-py beautifulsoup4 Pillow Pygments
npm ci --prefix examples/read-loop
python3 website/build.py
python3 -m http.server 18765 --bind 127.0.0.1 --directory website/dist
```

在浏览器打开 `http://127.0.0.1:18765/`。构建会将 Markdown 转为网页数据，并生成适合网页使用的图片副本，不修改原图。`website/dist/` 是生成目录。

私有托管站点是发布时的快照；课程更新后，需要重新构建并发布，线上内容才会变化。

## 界面验证

组件尺寸、响应式布局与浏览器操作记录见 [界面检查记录](UI-REVIEW.md)，其中包含实际截图。阅读页不统计进度或保存上次阅读位置。

第一章在浏览器运行 Pi 的实际循环，使用可编辑的内存文件和本地模拟模型。第三章运行两个工具的批次和后续输入。第六章的图解数据在构建时用 Pi 的切点计算与会话投影生成。三个图解的源码均在 `examples/read-loop/`。
