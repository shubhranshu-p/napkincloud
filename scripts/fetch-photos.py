"""Download the five Unsplash photographs and strip metadata for bundling."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, urlopen
from PIL import Image, ImageOps
import io, json, base64

ROOT = Path(__file__).resolve().parent.parent
PHOTOS = {
    'shop': 'photo-1441986300917-64674bd600d8',
    'concert': 'photo-1459749411175-04bf5292ceea',
    'news': 'photo-1504711434969-e33886168f5c',
    'restaurant': 'photo-1517248135467-4c7edcad34c4',
    'app': 'photo-1519389950473-47ba0277781c',
}
def download(item):
    name, photo = item
    url = f'https://images.unsplash.com/{photo}?auto=format&fit=crop&w=1200&q=85'
    with urlopen(Request(url, headers={'User-Agent': 'NapkinCloud/1.0'}), timeout=45) as response:
        original = Image.open(io.BytesIO(response.read())).convert('RGB')
    image = ImageOps.fit(original, (1200, 800), method=Image.Resampling.LANCZOS)
    output = ROOT / 'assets' / f'{name}.jpg'
    output.parent.mkdir(exist_ok=True)
    image.save(output, quality=86, optimize=True)
    print(f'{name}: {output.stat().st_size} bytes; metadata stripped', flush=True)
    return name, {'url': url, 'provider': 'Unsplash', 'license': 'https://unsplash.com/license', 'local': f'assets/{name}.jpg'}
with ThreadPoolExecutor(max_workers=5) as pool:
    records = dict(pool.map(download, PHOTOS.items()))
(ROOT / 'assets' / 'sources.json').write_text(json.dumps(records, indent=2) + '\n')
values = {f'{name}.jpg': {'type': 'image/jpeg', 'base64': base64.b64encode((ROOT/'assets'/f'{name}.jpg').read_bytes()).decode()} for name in PHOTOS}
(ROOT / 'src' / 'photos.mjs').write_text('// Bundled Unsplash photographs. Sources and license: assets/sources.json\nexport const PHOTO_ASSETS = ' + json.dumps(values) + ';\n')
