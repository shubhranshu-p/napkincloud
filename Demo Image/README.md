# Demo Image

Uploadable PNG diagrams, original SVG sources, and matching JSON graph/workload inputs:

- `00-Simple-starter.png`: client → API → PostgreSQL. Easiest recording example.
- `01-shop.png`: launch traffic with separate reads and queued writes.
- `02-news.png`: shared workspace traffic across two stores.
- `03-concert.png`: queued validation and background writes.

The website's **Upload architecture** button opens this demo library first. **Upload this demo** sends the selected PNG through Meta interpretation, then asks you to confirm the extracted graph. The matching workload is supplied, but the graph and results are not preloaded. **Download PNG** saves a real image you can upload yourself.

To choose a local file, click **Choose my image…**. Browsers cannot force Finder into an arbitrary folder. On macOS use Shift–Command–G in the picker and select this folder once; Chrome normally remembers subsequent selections. The top-level **Open Demo Images.command** opens this folder in Finder.

## Sample test inputs

| Input | Light traffic | Launch surge | Write-heavy |
| --- | ---: | ---: | ---: |
| Base requests/s | 100 | 120 | 120 |
| Peak requests/s | 300 | 3,000 | 2,800 |
| Reads | 90% | 90% | 20% |
| Assumed cache hits | 95% | 97% | 95% |
| Duration | 10 s | 20 s | 20 s |
| Deadline | 1,000 ms | 1,000 ms | 1,000 ms |
| Queue limit | 128 | 128 | 128 |
| p95 target | 300 ms | 300 ms | 300 ms |
| Success target | 99% | 99% | 99% |
| Seed | 42 | 42 | 42 |

The simple starter assumes API capacity 5,000 ops/s with concurrency 20, and database capacity 600 ops/s with concurrency 6. Other diagrams have their own explicit component assumptions in the JSON files. All values are synthetic inputs, not values inferred from a picture or production benchmarks.
