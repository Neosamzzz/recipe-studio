#!/bin/zsh
cd -- "${0:A:h}" || exit 1
python3 - <<'PY'
import http.server
import threading
import webbrowser
url = 'http://127.0.0.1:8766/'
try:
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 8766), http.server.SimpleHTTPRequestHandler)
except OSError:
    print('8766 端口已被占用。如果配方工作室已经启动，请使用原窗口。')
    raise SystemExit(1)
threading.Timer(0.3, lambda: webbrowser.open(url)).start()
print('配方工作室：' + url + '（关闭此终端停止服务）')
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
PY
