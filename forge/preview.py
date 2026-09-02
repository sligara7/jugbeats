#!/usr/bin/env python3
"""Render the chat preview card (cap:link-preview-card).

Run:  python3 forge/preview.py

Build-time only. Produces preview.png at 1200x630 — the size WhatsApp, iMessage
and everything else expect for a large link card.

The brief this is drawn to: it will usually be seen at thumbnail size in a chat
list, so the title has to survive being small, and the picture has to say
"rhythm game" in one glance. Everything else is decoration.
"""

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
BG = (13, 10, 20)
INK = (244, 238, 252)
HOT = (255, 61, 127)
LANES = [(255, 61, 127), (255, 176, 58), (61, 219, 217), (180, 108, 255)]

FONT_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
]


def font(size):
    for p in FONT_PATHS:
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img, "RGBA")

# --- the highway, on the right third -----------------------------------------
# Angled slightly so it reads as depth rather than as a bar chart.

hx, hw = 700, 460
lane_w = hw // 4
top, hit = 60, 470

for i in range(4):
    x = hx + i * lane_w
    d.rectangle([x + 4, top, x + lane_w - 4, hit], fill=(255, 255, 255, 12))

# Falling blocks — a plausible phonk pattern rather than a random scatter, so it
# reads as music to anyone who plays these games.
blocks = [(0, 110), (2, 150), (1, 205), (3, 205), (0, 265), (2, 300),
          (0, 355), (3, 355), (1, 410), (2, 440)]
for lane, y in blocks:
    x = hx + lane * lane_w
    d.rounded_rectangle([x + 10, y, x + lane_w - 10, y + 30], radius=9, fill=LANES[lane])

# the hit line
d.rectangle([hx, hit, hx + hw, hit + 4], fill=(255, 255, 255, 190))

# the four keys, grouped two and two — the layout is part of the identity
key_y, key_h = hit + 26, 96
gap = 12
group_w = 160          # matches the running layout: a wide gap up the middle,
key_w = (group_w - gap) // 2   # because the middle is where thumbs are not
for i in range(4):
    gx = hx if i < 2 else hx + hw - group_w
    x = gx + (i % 2) * (key_w + gap)
    d.rounded_rectangle([x, key_y, x + key_w, key_y + key_h], radius=20,
                        fill=LANES[i] + (70,), outline=LANES[i], width=3)

# --- the words, on the left --------------------------------------------------

d.text((80, 210), "JugBeats", font=font(104), fill=HOT)
d.text((84, 330), "make a phonk beat", font=font(44), fill=INK)
d.text((84, 396), "turn your phone sideways", font=font(30), fill=(150, 140, 170))
d.text((84, 440), "tap the blocks · send it back", font=font(30), fill=(150, 140, 170))

img.save("preview.png", optimize=True)
print(f"  wrote preview.png — {W}x{H}")
