"""在伪终端里运行 mox 命令行，像用户那样回答提问。
用法：python3 pty-driver.py '<JSON：{"argv": [...], "prompts": ["/命令", "任务"], "answers": ["1", "2"]}>'
mox 的 ask 只在 stdin 是终端时才会提问，所以要借一个伪终端：看到“输入序号：”就送出下一个回答，
看到主提示符“› ”：依次送出 prompts 里的每一句（命令或任务），都送完之后送 /exit。把终端上显示的内容原样打印出来。
"""
import json, os, pty, select, sys, time

spec = json.loads(sys.argv[1])
answers, prompts_left = list(spec['answers']), list(spec.get('prompts') or [spec['prompt']])
pid, fd = pty.fork()
if pid == 0:
    os.execvp(spec['argv'][0], spec['argv'])
out, prompts, deadline = '', 0, time.time() + 40
seen_ask = 0
while time.time() < deadline:
    ready, _, _ = select.select([fd], [], [], 0.2)
    if not ready:
        continue
    try:
        data = os.read(fd, 4096).decode(errors='replace')
    except OSError:
        break
    if not data:
        break
    out += data
    # 每次只在新出现的提示后回答一次
    if out.count('输入序号：') > seen_ask:
        seen_ask = out.count('输入序号：')
        os.write(fd, (answers.pop(0) + '\n').encode())
    if out.count('› ') > prompts:
        prompts = out.count('› ')
        if prompts_left:
            os.write(fd, (prompts_left.pop(0) + '\n').encode())
        else:
            os.write(fd, b'/exit\n')
try:
    os.waitpid(pid, 0)
except ChildProcessError:
    pass
sys.stdout.write(out)
