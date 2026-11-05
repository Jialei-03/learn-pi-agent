"""Offline regression for the live experiment; does not contact MiniMax."""
import json
import os
from pathlib import Path
import subprocess
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    requests = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.requests.append(request)
        if len(self.requests) == 1:
            deltas = [
                {'reasoning_content': '测试推理'},
                {'tool_calls': [{'index': 0, 'id': 'call_test_1', 'type': 'function', 'function': {'name': 'read_file', 'arguments': '{"path":'}}]},
                {'tool_calls': [{'index': 0, 'function': {'arguments': '"README.md"}'}}]},
            ]
            finish = 'tool_calls'
        else:
            deltas = [{'content': 'It counts apples.'}]
            finish = 'stop'
        chunks = [{'model': 'MiniMax-M3.1-Flash', 'choices': [{'delta': d, 'finish_reason': None}]} for d in deltas]
        chunks.append({'model': 'MiniMax-M3.1-Flash', 'choices': [{'delta': {}, 'finish_reason': finish}]})
        payload = ''.join('data: ' + json.dumps(c, ensure_ascii=False) + '\n\n' for c in chunks) + 'data: [DONE]\n\n'
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        raw = payload.encode('utf-8')
        for i in range(0, len(raw), 7):
            self.wfile.write(raw[i:i + 7])
            self.wfile.flush()


class LiveExperimentTest(unittest.TestCase):
    def test_tool_id_reasoning_and_temporary_file_round_trip(self):
        Handler.requests = []
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        env = os.environ.copy()
        env.update(MINIMAX_API_KEY='local-test-key', MINIMAX_BASE_URL=f'http://127.0.0.1:{server.server_port}/v1')
        try:
            script = Path(__file__).with_name('minimax-live.py')
            result = subprocess.run(['python3', str(script)], capture_output=True, text=True, env=env, timeout=15, check=True)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        self.assertEqual(len(Handler.requests), 2)
        history = Handler.requests[1]['messages']
        self.assertEqual(history[-2]['reasoning_content'], '测试推理')
        self.assertEqual(history[-1]['tool_call_id'], 'call_test_1')
        self.assertEqual(history[-1]['content'], '# Demo\nThis project counts apples.\n')
        report = json.loads(result.stdout)
        self.assertEqual(report['kind'], 'custom-endpoint-observation')
        self.assertTrue(report['checks']['tool_id_copied_from_response'])
        self.assertTrue(report['checks']['reasoning_returned_unchanged'])
        self.assertNotIn('测试推理', result.stdout)
        self.assertNotIn('local-test-key', result.stdout)


if __name__ == '__main__':
    unittest.main()
