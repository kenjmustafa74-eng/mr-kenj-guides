"""Generates the app icons (PWA + store artwork).
Usage: python3 tools/make_icons.py [label] [out-dir]   e.g. 5  (writes public/icons)  or  6 public/icons-year6"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

LABEL = sys.argv[1] if len(sys.argv) > 1 else '5'
BG = (31, 78, 95); CREAM = (247, 244, 238); PAGE2 = (234, 228, 216); GOLD = (214, 163, 74)
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
os.makedirs(OUT, exist_ok=True)

def font(sz):
    for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf']:
        if os.path.exists(f):
            return ImageFont.truetype(f, sz)
    return ImageFont.load_default()

def make(size, maskable=False, rounded=True):
    S = size * 4
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    if maskable or not rounded: d.rectangle([0, 0, S, S], fill=BG)
    else: d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=BG)
    pad = 0.2 if maskable else 0.1
    w = S * (1 - 2 * pad); mid = S / 2
    top = S * (pad + 0.12); bot = S * (1 - pad - 0.2)
    d.polygon([(mid, top + w * 0.06), (mid - w * 0.46, top), (mid - w * 0.46, bot - w * 0.04), (mid, bot)], fill=CREAM)
    d.polygon([(mid, top + w * 0.06), (mid + w * 0.46, top), (mid + w * 0.46, bot - w * 0.04), (mid, bot)], fill=PAGE2)
    d.line([(mid, top + w * 0.06), (mid, bot)], fill=BG, width=max(2, int(S * 0.012)))
    for i in range(4):
        y = top + w * 0.12 + i * w * 0.1
        d.line([(mid - w * 0.38, y - w * 0.01), (mid - w * 0.08, y + w * 0.02)], fill=(160, 170, 175), width=max(2, int(S * 0.012)))
    d.text((mid + w * 0.23, top + w * 0.25), LABEL, font=font(int(w * 0.36)), fill=BG, anchor='mm')
    d.polygon([(mid + w * 0.3, bot - w * 0.06), (mid + w * 0.38, bot - w * 0.06), (mid + w * 0.38, bot + w * 0.1), (mid + w * 0.34, bot + w * 0.06), (mid + w * 0.3, bot + w * 0.1)], fill=GOLD)
    return im.resize((size, size), Image.LANCZOS)

os.makedirs(OUT, exist_ok=True)
make(192).save(f'{OUT}/icon-192.png'); make(512).save(f'{OUT}/icon-512.png')
make(512, maskable=True).save(f'{OUT}/maskable-512.png')
make(180, rounded=False).convert('RGB').save(f'{OUT}/apple-touch-icon.png')
make(32).save(f'{OUT}/favicon-32.png')
make(1024, rounded=False).convert('RGB').save(f'{OUT}/icon-1024.png')  # App Store / Play Store artwork
print('icons written to', OUT)
