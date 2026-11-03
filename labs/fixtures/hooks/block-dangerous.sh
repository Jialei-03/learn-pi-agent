#!/bin/sh
# PreToolUse（Bash）：最简单的钩子——发现危险命令，往 stderr 写原因，退出码 2。
input=$(cat)
if echo "$input" | grep -qE 'rm -rf|git push (-f|--force)'; then
  echo "禁止执行破坏性命令（rm -rf / 强制推送）。请换一种更安全的做法。" >&2
  exit 2
fi
exit 0
