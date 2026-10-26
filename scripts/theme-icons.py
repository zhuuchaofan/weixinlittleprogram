"""按主题给图标换色：assets/theme-src 里主色（#f2614f）的图标，生成到 images/themes/<主题 id>/。

新增或修改 config/themes.ts 里的主题后运行：python3 scripts/theme-icons.py（需要 Pillow）。
"""
import pathlib
import re

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'miniprogram'
SRC = ROOT.parent / 'assets' / 'theme-src'
OUT = ROOT / 'images' / 'themes'
SOURCE_ACCENT = (242, 97, 79)  # 原图标的主色 #f2614f


def themes():
    text = (ROOT / 'config' / 'themes.ts').read_text(encoding='utf-8')
    for match in re.finditer(r"theme\('(\w+)'.*?accent: '(#[0-9a-fA-F]{6})'", text, re.S):
        yield match.group(1), match.group(2)


def close(pixel, target, tolerance=40):
    return all(abs(a - b) <= tolerance for a, b in zip(pixel, target))


def recolor_png(source, target, accent):
    rgb = tuple(int(accent[i:i + 2], 16) for i in (1, 3, 5))
    image = Image.open(source).convert('RGBA')
    pixels = [
        (*rgb, a) if close((r, g, b), SOURCE_ACCENT) else (r, g, b, a)
        for r, g, b, a in image.getdata()
    ]
    image.putdata(pixels)
    image.save(target, optimize=True)


def main():
    for theme_id, accent in themes():
        folder = OUT / theme_id
        folder.mkdir(parents=True, exist_ok=True)
        for source in sorted(SRC.iterdir()):
            target = folder / source.name
            if source.suffix == '.svg':
                text = source.read_text(encoding='utf-8')
                target.write_text(re.sub('#f2614f', accent, text, flags=re.I), encoding='utf-8')
            elif source.suffix == '.png':
                recolor_png(source, target, accent)
        print(theme_id, accent)


if __name__ == '__main__':
    main()
