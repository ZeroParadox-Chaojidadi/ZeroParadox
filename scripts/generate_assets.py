from PIL import Image, ImageDraw
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "src", "renderer", "src", "assets")
BUILD = os.path.join(ROOT, "build")
os.makedirs(ASSETS, exist_ok=True)
os.makedirs(BUILD, exist_ok=True)

# A flat, original isometric block mark. No external art or textures.
S = 1024
icon = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(icon)
d.rounded_rectangle((24, 24, S - 24, S - 24), radius=230, fill=(9, 6, 6, 255))
d.rounded_rectangle((56, 56, S - 56, S - 56), radius=205, outline=(255, 90, 92, 70), width=5)

cx, cy = 512, 500
rx, ry = 252, 145
top = (cx, cy - 315)
right = (cx + rx, cy - 315 + ry)
mid = (cx, cy)
left = (cx - rx, cy - 315 + ry)
lower = 260
face_left_bottom = (cx - rx, cy + lower)
face_bottom = (cx, cy + lower + ry)
face_right_bottom = (cx + rx, cy + lower)

# Three flat faces.
d.polygon([top, right, mid, left], fill=(112, 36, 39, 255))
d.polygon([left, mid, face_bottom, face_left_bottom], fill=(68, 22, 25, 255))
d.polygon([mid, right, face_right_bottom, face_bottom], fill=(44, 14, 17, 255))

# Neon wireframe.
d.line([top, right, mid, left, top], fill=(255, 96, 98, 255), width=17, joint="curve")
d.line(
    [left, face_left_bottom, face_bottom, face_right_bottom, right],
    fill=(255, 96, 98, 255),
    width=15,
    joint="curve",
)
d.line([mid, face_bottom], fill=(255, 96, 98, 255), width=16)

# A single highlight to suggest a polished face.
d.ellipse((cx - 22, cy - 202, cx + 22, cy - 158), fill=(255, 224, 224, 230))

icon.save(os.path.join(BUILD, "icon.png"), optimize=True)
icon.save(os.path.join(ASSETS, "logo.png"), optimize=True)
icon.resize((256, 256), Image.Resampling.LANCZOS).save(os.path.join(BUILD, "icon-256.png"))
icon.resize((256, 256), Image.Resampling.LANCZOS).save(
    os.path.join(BUILD, "icon.ico"),
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print("generated app icon")
