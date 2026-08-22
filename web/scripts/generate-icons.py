#!/usr/bin/env python3
"""
Generates the PWA icon set from the same mark as public/favicon.svg.

Run after changing the mark:  python3 web/scripts/generate-icons.py
Requires Pillow. The PNGs are committed, so this is not part of the build.
"""
from PIL import Image, ImageDraw

BG = (15, 23, 42, 255)       # slate-900, matches theme_color
FG = (56, 189, 248, 255)     # sky-400
SS = 4                       # supersample factor, downscaled with LANCZOS


def draw_mark(draw: ImageDraw.ImageDraw, size: int, offset: int) -> None:
    """
    An equals sign: two balanced bars. It says "even" directly, and unlike a
    three-bar mark it never reads as a hamburger menu at small sizes.
    """
    unit = size / 32
    pad = offset

    def bar(y: float) -> None:
        h = 4 * unit
        cy = pad + y * unit
        draw.rounded_rectangle(
            [pad + 7 * unit, cy - h / 2, pad + 25 * unit, cy + h / 2],
            radius=h / 2,
            fill=FG,
        )

    bar(12.5)
    bar(19.5)


def render(size: int, *, rounded: bool, inset: float = 0.0) -> Image.Image:
    canvas = size * SS
    image = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    if rounded:
        draw.rounded_rectangle([0, 0, canvas - 1, canvas - 1], radius=canvas * 7 / 32, fill=BG)
    else:
        draw.rectangle([0, 0, canvas - 1, canvas - 1], fill=BG)

    # `inset` shrinks the mark so a maskable icon survives being cropped to a
    # circle: Android only guarantees the central 80%.
    mark = canvas * (1 - inset)
    draw_mark(draw, mark, offset=(canvas - mark) / 2)

    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    out = 'web/public'
    render(192, rounded=True).save(f'{out}/pwa-192.png')
    render(512, rounded=True).save(f'{out}/pwa-512.png')
    # Maskable: full bleed, mark pulled well inside the safe zone.
    render(512, rounded=False, inset=0.30).save(f'{out}/pwa-maskable-512.png')
    # iOS composites onto white if there is alpha, so flatten it.
    render(180, rounded=True).convert('RGB').save(f'{out}/apple-touch-icon.png')
    print('wrote pwa-192, pwa-512, pwa-maskable-512, apple-touch-icon')


if __name__ == '__main__':
    main()
