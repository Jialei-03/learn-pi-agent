#!/bin/sh
# SessionStart：纯文本 stdout 会作为补充信息交给模型。
echo "项目信息（来自 SessionStart 钩子）：当前分支 main；部署脚本是 ./deploy.sh；提交前必须运行 npm test。"
