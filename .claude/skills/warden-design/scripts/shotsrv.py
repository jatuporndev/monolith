"""Tiny local receiver: the game page POSTs canvas captures (data URLs) here; they are written as JPEGs."""
import base64, http.server, os, sys

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(n).decode('ascii', 'ignore')
        name, _, data = body.partition('|')
        name = ''.join(c for c in name if c.isalnum() or c in '-_') or 'shot'
        raw = base64.b64decode(data.split(',', 1)[1])
        with open(os.path.join(OUT, name + '.jpg'), 'wb') as f:
            f.write(raw)
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

    def log_message(self, *a):
        pass

http.server.HTTPServer(('127.0.0.1', 5301), H).serve_forever()
