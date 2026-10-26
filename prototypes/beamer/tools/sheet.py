"""Contact sheets and the cross-style comparison image.

usage:
  python tools/sheet.py sheet <style_dir>          -> <style_dir>/contact.png
  python tools/sheet.py compare <out.png> <pages> <style_dir>...   e.g. 3,5
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
GAP = 12
BG = (236, 237, 239)
LABEL = (60, 64, 70)


def font(size):
    for f in ("fonts/Inter-Medium.otf", "fonts/NotoSans-Regular.ttf"):
        p = ROOT / f
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def sheet(style):
    pngs = sorted((ROOT / style / "png").glob("p-*.png"))
    ims = [Image.open(p).convert("RGB") for p in pngs]
    w, h = ims[0].size
    cols = 3
    rows = (len(ims) + cols - 1) // cols
    out = Image.new("RGB", (cols * w + (cols + 1) * GAP, rows * (h + 18) + (rows + 1) * GAP), BG)
    d = ImageDraw.Draw(out)
    f = font(11)
    for i, im in enumerate(ims):
        r, c = divmod(i, cols)
        x = GAP + c * (w + GAP)
        y = GAP + r * (h + 18 + GAP)
        d.text((x, y), f"p{i + 1}", fill=LABEL, font=f)
        out.paste(im, (x, y + 16))
    out.save(ROOT / style / "contact.png")


def compare(outname, pages, styles):
    pages = [int(p) for p in pages.split(",")]
    tiles = {(s, p): Image.open(ROOT / s / "png" / f"p-{p:02d}.png").convert("RGB")
             for s in styles for p in pages}
    w, h = next(iter(tiles.values())).size
    head = 26
    side = 110
    out = Image.new("RGB", (side + len(pages) * (w + GAP) + GAP, head + len(styles) * (h + GAP) + GAP), BG)
    d = ImageDraw.Draw(out)
    f = font(13)
    for j, p in enumerate(pages):
        d.text((side + GAP + j * (w + GAP), 6), f"page {p}", fill=LABEL, font=f)
    for i, s in enumerate(styles):
        y = head + GAP + i * (h + GAP)
        d.text((GAP, y + h // 2 - 8), s, fill=LABEL, font=f)
        for j, p in enumerate(pages):
            out.paste(tiles[(s, p)], (side + GAP + j * (w + GAP), y))
    out.save(ROOT / outname)


if __name__ == "__main__":
    if sys.argv[1] == "sheet":
        for s in sys.argv[2:]:
            sheet(s)
    else:
        compare(sys.argv[2], sys.argv[3], sys.argv[4:])
