"""Draw the ROW lockups (wordmark + Rotary wheel) at the sizes of the RIZones files they replace.

usage: python tools/make_logos.py <images dir>   (needs Pillow; uses Windows Segoe UI fonts)
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

FONT_BOLD = r"C:\Windows\Fonts\segoeuib.ttf"
FONT = r"C:\Windows\Fonts\segoeui.ttf"
BLUE, WHITE = (23, 69, 143, 255), (255, 255, 255, 255)
# file -> (size, text colour, wheel file)
TARGETS = {
    "rotary-branding.png": ((995, 295), BLUE, "rotary-wheel-gold.png"),
    "rotary-masterbrand.png": ((905, 295), BLUE, "rotary-wheel-gold.png"),
    "rotary-masterbrand-white.png": ((905, 295), WHITE, "rotary-wheel-white.png"),
    "rotary-white-live.png": ((905, 295), WHITE, "rotary-wheel-white.png"),
}


def fit(draw, text, font_path, max_w, start):
    size = start
    while size > 10:
        f = ImageFont.truetype(font_path, size)
        if draw.textlength(text, font=f) <= max_w:
            return f
        size -= 2
    return ImageFont.truetype(font_path, size)


def lockup(images, name, size, colour, wheel_name):
    w, h = size
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    wheel = Image.open(os.path.join(images, wheel_name)).convert("RGBA")
    ws = int(h * 0.86)
    wheel = wheel.resize((ws, ws), Image.LANCZOS)
    img.alpha_composite(wheel, (w - ws - 8, (h - ws) // 2))
    d = ImageDraw.Draw(img)
    text_w = w - ws - 40
    big = fit(d, "ROW", FONT_BOLD, text_w, 150)
    small = fit(d, "Roster On Wheels", FONT, text_w, 72)
    bw = d.textlength("ROW", font=big)
    sw = d.textlength("Roster On Wheels", font=small)
    right = w - ws - 28
    d.text((right - bw, int(h * 0.04)), "ROW", font=big, fill=colour)
    d.text((right - sw, int(h * 0.58)), "Roster On Wheels", font=small, fill=colour)
    img.save(os.path.join(images, name))
    print("wrote", name, size)


if __name__ == "__main__":
    images = sys.argv[1]
    for name, (size, colour, wheel) in TARGETS.items():
        lockup(images, name, size, colour, wheel)
