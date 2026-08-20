from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SIZE = 512
image = Image.new("RGBA", (SIZE, SIZE), "#0b0d14")
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((28, 28, 484, 484), radius=94, fill="#121621", outline="#33405a", width=12)
crest = [(256, 74), (422, 164), (374, 410), (138, 410), (90, 164)]
draw.polygon(crest, fill="#f5c451")
draw.line(crest + [crest[0]], fill="#ffe29a", width=8, joint="curve")
font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 242)
box = draw.textbbox((0, 0), "T", font=font)
draw.text(((SIZE - (box[2] - box[0])) / 2, 115), "T", font=font, fill="#17130d")

(ROOT / "build").mkdir(exist_ok=True)
image.save(ROOT / "public" / "icon.png", optimize=True)
image.save(ROOT / "build" / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
