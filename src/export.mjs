import { VERSION, validateGraph, validateWorkload, applyPatch } from './model.mjs';
import { simulate, stressSuite } from './simulator.mjs';

const API_PY = String.raw`import json, os, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import psycopg
import redis

DATABASE_URL = os.environ['DATABASE_URL']
cache = redis.Redis.from_url(os.environ['REDIS_URL'], decode_responses=True) if os.environ.get('REDIS_URL') else None

def database(sql, args=(), one=True):
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cursor:
            cursor.execute(sql, args)
            return cursor.fetchone() if one else cursor.fetchall()

class Handler(BaseHTTPRequestHandler):
    def send(self, status, value):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == '/health':
            self.send(200, {'ok': True, 'cache_enabled': cache is not None})
            return
        parts = self.path.strip('/').split('/')
        if len(parts) != 2 or parts[0] not in ('products', 'inventory') or not parts[1].isdigit():
            self.send(404, {'error': 'Use /products/1 or /inventory/1'})
            return
        product_id = int(parts[1])
        try:
            if parts[0] == 'inventory':
                # Stock is consistency-sensitive and always bypasses the cache.
                row = database('SELECT stock FROM products WHERE id=%s', (product_id,))
                self.send(200 if row else 404, {'stock': row[0]} if row else {'error': 'Not found'})
                return
            key = 'product:' + str(product_id)
            if cache:
                try:
                    hit = cache.get(key)
                    if hit:
                        self.send(200, {**json.loads(hit), 'source': 'cache'})
                        return
                except redis.RedisError:
                    pass
            row = database('SELECT id, name, price_cents FROM products WHERE id=%s', (product_id,))
            if not row:
                self.send(404, {'error': 'Not found'})
                return
            product = {'id': row[0], 'name': row[1], 'price_cents': row[2]}
            if cache:
                try:
                    cache.setex(key, 60, json.dumps(product))
                except redis.RedisError:
                    pass
            self.send(200, {**product, 'source': 'database'})
        except Exception:
            self.send(503, {'error': 'Database unavailable'})

    def do_POST(self):
        parts = self.path.strip('/').split('/')
        if len(parts) != 2 or parts[0] != 'stock' or not parts[1].isdigit():
            self.send(404, {'error': 'Use POST /stock/1 with {"quantity": 1}'})
            return
        try:
            length = int(self.headers.get('Content-Length', 0))
            if length > 4096:
                self.send(413, {'error': 'Body too large'})
                return
            body = json.loads(self.rfile.read(length))
            quantity = body.get('quantity', 1)
            if not isinstance(quantity, int) or isinstance(quantity, bool) or not 1 <= quantity <= 100:
                raise ValueError('Invalid quantity')
            product_id = int(parts[1])
            # Atomic conditional write prevents overselling; Redis never decides stock.
            row = database('UPDATE products SET stock=stock-%s WHERE id=%s AND stock >= %s RETURNING stock', (quantity, product_id, quantity))
            if cache:
                try:
                    cache.delete('product:' + str(product_id))
                except redis.RedisError:
                    pass
            self.send(200 if row else 409, {'stock': row[0]} if row else {'error': 'Insufficient stock'})
        except (ValueError, json.JSONDecodeError):
            self.send(400, {'error': 'Invalid JSON or quantity'})
        except Exception:
            self.send(503, {'error': 'Database unavailable'})

    def log_message(self, *args):
        pass

if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
`;
const LOADTEST_PY = String.raw`import argparse, concurrent.futures, json, platform, random, time, urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://gateway')
parser.add_argument('--rps', type=int, default=100)
parser.add_argument('--seconds', type=int, default=15)
parser.add_argument('--reads', type=float, default=0.9)
args = parser.parse_args()
if not 1 <= args.rps <= 1000 or not 1 <= args.seconds <= 120 or not 0 <= args.reads <= 1:
    parser.error('Use 1–1000 RPS, 1–120 seconds, and a read fraction between 0 and 1.')
rng = random.Random(42)
def request(spec):
    read, product = spec
    path = '/products/' if read else '/stock/'
    body = None if read else json.dumps({'quantity': 1}).encode()
    req = urllib.request.Request(args.url + path + str(product), data=body, headers={'Content-Type': 'application/json'})
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            response.read()
            return response.status == 200, (time.monotonic()-started)*1000
    except Exception:
        return False, (time.monotonic()-started)*1000
started = time.monotonic()
futures = []
with concurrent.futures.ThreadPoolExecutor(max_workers=64) as pool:
    for i in range(args.rps * args.seconds):
        due = started + i / args.rps
        time.sleep(max(0, due - time.monotonic()))
        futures.append(pool.submit(request, (rng.random() < args.reads, rng.randint(1, 100))))
    results = [f.result() for f in futures]
elapsed = time.monotonic() - started
latencies = sorted(ms for ok, ms in results if ok)
def percentile(p):
    return latencies[min(len(latencies)-1, int(len(latencies)*p))] if latencies else None
print(json.dumps({'provenance': 'measured_reference_stack', 'environment': platform.platform(),
    'offered_rps': args.rps, 'requests': len(results), 'successful': len(latencies),
    'success_rate': len(latencies)/len(results), 'elapsed_seconds': elapsed,
    'achieved_rps': len(results)/elapsed, 'p50_ms': percentile(.5), 'p95_ms': percentile(.95), 'p99_ms': percentile(.99)}, indent=2))
`;
export async function exportFiles(input) {
  const original = validateGraph(input.graph), workload = validateWorkload(input.workload);
  const patch = input.patch || null, graph = patch ? applyPatch(original, patch) : original;
  const cached = graph.nodes.some(n => n.type === 'redis');
  const replicas = graph.nodes.find(n => n.type === 'api').replicas;
  const evidence = { version: VERSION, createdAt: new Date().toISOString(), provenance: 'simulated',
    baseline: simulate(original, workload), selected: simulate(graph, workload), patch, stress: stressSuite(graph, workload),
    verification: { simulation: true, templateCompilation: true, composeRuntime: false, benchmark: false },
    notes: ['This reference stack implements routing and cache behavior. Its measured performance must be tested separately.', 'Service capacities and cache hit ratios in the simulator are assumptions, not deployment guarantees.'] };
  // Agent history is useful context but is explicitly not authoritative simulation evidence.
  if (input.agent) {
    evidence.agentContext = { model: String(input.agent.model || '').slice(0, 80), explanation: String(input.agent.explanation || '').slice(0, 3000), provenance: 'client-supplied run context; numerical experiments independently recomputed' };
    evidence.candidateExperiments = (Array.isArray(input.agent.experiments) ? input.agent.experiments : []).slice(0, 12).map(c => {
      const result = simulate(applyPatch(original, c.patch), workload);
      return { id: String(c.id).slice(0, 60), label: String(c.label).slice(0, 120), patch: c.patch, summary: result.summary, nodes: result.nodes };
    });
  }
  const fingerprint = JSON.stringify({ original, workload, patch, version: VERSION });
  evidence.inputHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint)))].map(n => n.toString(16).padStart(2, '0')).join('');
  if(original.routingVersion===2){evidence.verification.templateCompilation=false;evidence.notes=['Flow simulation only; no runtime deployment has been generated for this extended topology.'];return {evidence,files:{'before.json':JSON.stringify(original,null,2),'after.json':JSON.stringify(graph,null,2),'scenario.json':JSON.stringify(workload,null,2),'evidence.json':JSON.stringify(evidence,null,2),'README.md':'# NapkinCloud flow experiment\n\nThis bundle contains reproducible flow inputs and independently recomputed simulation evidence. It does not contain a runtime deployment. Gateways, services, queues, and workers are finite-queue processing stages. Reads and writes follow directed conditional routes; writes bypass Redis. Queue/worker completion is awaited. Fan-out joins, network loss, retries, and production benchmarks are not modeled.\n'}};}
  const compose = `name: napkincloud-reference
services:
  gateway:
    image: nginx:1.27-alpine
    ports: ["127.0.0.1:8080:80"]
    volumes: ["./app/nginx.conf:/etc/nginx/conf.d/default.conf:ro"]
    depends_on: [api]
  api:
    build: .
    expose: ["8080"]
    deploy:
      replicas: ${replicas}
    environment:
      DATABASE_URL: postgresql://napkin:napkin-local@db:5432/napkin
${cached ? '      REDIS_URL: redis://cache:6379/0\n' : ''}    depends_on:
      db:
        condition: service_healthy
${cached ? '      cache:\n        condition: service_healthy\n' : ''}  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: napkin
      POSTGRES_PASSWORD: napkin-local
      POSTGRES_DB: napkin
    volumes: ["./db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U napkin"]
      interval: 2s
      timeout: 2s
      retries: 15
${cached ? '  cache:\n    image: redis:7-alpine\n    healthcheck:\n      test: ["CMD", "redis-cli", "ping"]\n      interval: 2s\n      timeout: 2s\n      retries: 15\n' : ''}  loadtest:
    build: .
    profiles: [test]
    entrypoint: ["python", "loadtest/run.py"]
    depends_on: [gateway]
`;
  const files = {
    'compose.yaml': compose,
    'Dockerfile': 'FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY app ./app\nCOPY loadtest ./loadtest\nEXPOSE 8080\nCMD ["python", "app/server.py"]\n',
    'requirements.txt': 'psycopg[binary]>=3.2,<4\nredis>=5,<7\n',
    'app/server.py': API_PY,
    'app/nginx.conf': 'upstream shop { server api:8080; }\nserver { listen 80; location / { proxy_pass http://shop; } }\n',
    'db/init.sql': "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price_cents INTEGER NOT NULL, stock INTEGER NOT NULL CHECK (stock >= 0));\nINSERT INTO products SELECT n, 'Product ' || n, 1000 + n, 1000000 FROM generate_series(1,100) n;\n",
    'loadtest/run.py': LOADTEST_PY,
    'before.json': JSON.stringify(original, null, 2),
    'architecture.json': JSON.stringify(graph, null, 2),
    'scenario.json': JSON.stringify(workload, null, 2),
    'evidence.json': JSON.stringify(evidence, null, 2),
    'README.md': `# NapkinCloud reference stack\n\nGenerated from a supported architecture template. This is a local engineering experiment; default credentials are fixture data.\n\n## Run\n\n\`\`\`sh\ndocker compose up --build -d\ncurl http://localhost:8080/products/1\ncurl http://localhost:8080/inventory/1\ncurl -X POST http://localhost:8080/stock/1 -H 'Content-Type: application/json' -d '{"quantity":1}'\ndocker compose --profile test run --rm loadtest --rps 100 --seconds 15\ndocker compose down\n\`\`\`\n\nCache enabled: ${cached}. API replicas: ${replicas}. Catalog responses may be cached for 60 seconds. Stock reads and writes always reach PostgreSQL; stock updates are atomic and invalidate the product cache key.\n\n## Evidence\n\nThe export recomputes simulation results server-side. See evidence.json for frozen inputs, seed, scenario metrics, exploratory stress cases, and input hash. Compose has been compiled from maintained templates; it has NOT been runtime-tested by downloading this bundle. Run it to obtain measured reference-stack results.\n\nThe simulation's capacities, hit ratios, and exponential service distributions are explicit assumptions. Docker Compose does not guarantee those performance values. Record your machine and load-test results separately. The synthetic cold-start model ramps hit probability over five seconds; actual cache warmup depends on key distribution and TTL.\n`
  };
  return { files, evidence };
}
export function tarFiles(files) {
  const encoder = new TextEncoder(), chunks = [];
  for (const [name, text] of Object.entries(files)) {
    const bytes = encoder.encode(text), header = new Uint8Array(512);
    const set = (offset, length, value) => header.set(encoder.encode(value).slice(0, length), offset);
    set(0, 100, name); set(100, 8, '0000644\0'); set(108, 8, '0000000\0'); set(116, 8, '0000000\0');
    set(124, 12, bytes.length.toString(8).padStart(11, '0') + '\0'); set(136, 12, '00000000000\0');
    set(148, 8, '        '); set(156, 1, '0'); set(257, 6, 'ustar\0'); set(263, 2, '00');
    const sum = header.reduce((a, n) => a + n, 0); set(148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
    chunks.push(header, bytes, new Uint8Array((512 - bytes.length % 512) % 512));
  }
  chunks.push(new Uint8Array(1024));
  const out = new Uint8Array(chunks.reduce((n, b) => n + b.length, 0)); let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}
