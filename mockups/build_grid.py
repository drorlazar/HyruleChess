"""Compose comparison grid from mockup screenshots."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "screenshots" / "mockups"
OUT = ROOT / "screenshots" / "mockups"

# Try to find a decent font
def find_font(size):
    for p in [
        "/System/Library/Fonts/Supplemental/Georgia.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf",
    ]:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def label(img, text, size=32, pad=14):
    """Draw a gold label in top-left corner."""
    d = ImageDraw.Draw(img)
    font = find_font(size)
    bbox = d.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0] + pad * 2
    h = bbox[3] - bbox[1] + pad * 2
    d.rectangle([0, 0, w, h], fill=(10, 6, 2, 220))
    d.text((pad, pad - 4), text, fill=(255, 215, 0), font=font)

def paste_scaled(canvas, img_path, x, y, w, h):
    img = Image.open(img_path).convert("RGB")
    img = img.resize((w, h), Image.LANCZOS)
    canvas.paste(img, (x, y))

# ---- Grid per concept: 2x2 (desktop lobby / game, mobile lobby / game) ----
def build_concept_grid(concept):
    # Desktop is 1920x1080 (16:9), mobile 390x844 (~0.46 aspect)
    # Thumbnail sizes: desktop 960x540, mobile 216x468
    # Layout: top row desktop lobby + desktop game, bottom row mobile lobby + mobile game side-by-side
    dw, dh = 960, 540
    mw, mh = 216, 468
    gap = 24
    pad = 28
    title_h = 60

    # Top row: 2 desktop thumbs side-by-side
    top_row_w = dw * 2 + gap
    # Bottom row: 2 mobile thumbs
    bot_row_w = mw * 2 + gap
    row_w = max(top_row_w, bot_row_w)
    W = row_w + pad * 2
    H = pad + title_h + dh + gap + mh + pad

    canvas = Image.new("RGB", (W, H), (8, 4, 2))
    d = ImageDraw.Draw(canvas)

    concept_names = {
        "A": "CONCEPT A  —  CODEX CORNERS",
        "B": "CONCEPT B  —  BATTLE HUD",
        "C": "CONCEPT C  —  TOME RAILS",
    }
    font_t = find_font(28)
    d.text((pad + 10, pad + 12), concept_names[concept], fill=(255, 215, 0), font=font_t)

    y0 = pad + title_h
    # Desktop lobby + game side by side
    paste_scaled(canvas, SRC / f"{concept}-desktop-lobby.png", pad, y0, dw, dh)
    paste_scaled(canvas, SRC / f"{concept}-desktop-game.png", pad + dw + gap, y0, dw, dh)
    # Mobile lobby + game below, aligned under their desktop counterparts
    y1 = y0 + dh + gap
    # Place mobile thumbs centered under each desktop
    mx0 = pad + (dw - mw) // 2
    mx1 = pad + dw + gap + (dw - mw) // 2
    paste_scaled(canvas, SRC / f"{concept}-mobile-lobby.png", mx0, y1, mw, mh)
    paste_scaled(canvas, SRC / f"{concept}-mobile-game.png", mx1, y1, mw, mh)

    # Labels
    font_s = find_font(22)
    lbls = [
        (pad + 12, y0 + 8, "DESKTOP — LOBBY"),
        (pad + dw + gap + 12, y0 + 8, "DESKTOP — GAME"),
        (mx0 + 8, y1 + 8, "MOBILE — LOBBY"),
        (mx1 + 8, y1 + 8, "MOBILE — GAME"),
    ]
    for (lx, ly, lt) in lbls:
        bb = d.textbbox((0, 0), lt, font=font_s)
        d.rectangle([lx - 6, ly - 4, lx + (bb[2] - bb[0]) + 10, ly + (bb[3] - bb[1]) + 6], fill=(10, 6, 2, 220))
        d.text((lx, ly), lt, fill=(255, 215, 0), font=font_s)

    out = OUT / f"GRID-concept-{concept}.png"
    canvas.save(out, "PNG", optimize=True)
    print(f"wrote {out}  ({W}x{H})")
    return out

# ---- Final all-concepts grid: stack the 3 concept grids vertically, shrunk ----
def build_all():
    concept_imgs = [Image.open(OUT / f"GRID-concept-{c}.png").convert("RGB") for c in "ABC"]
    scale = 0.55
    scaled = [img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS) for img in concept_imgs]
    W = scaled[0].width + 40
    H = sum(img.height for img in scaled) + 40 + 20 * 2
    canvas = Image.new("RGB", (W, H), (5, 2, 1))
    y = 20
    for img in scaled:
        canvas.paste(img, (20, y))
        y += img.height + 20
    out = OUT / "GRID-all-concepts.png"
    canvas.save(out, "PNG", optimize=True)
    print(f"wrote {out}  ({W}x{H})")
    return out

for c in "ABC":
    build_concept_grid(c)
build_all()
print("done")
