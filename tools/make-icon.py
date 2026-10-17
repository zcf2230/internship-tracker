#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成桌面版应用图标 desktop/build/icon.ico（青绿圆角底 + 白色上升柱线）。

设计语言与站点一致：强调色 #176B75（青绿）、圆角、单一强调色。
用 4 倍超采样画再缩小，保证 16px 小尺寸下边缘依然干净。

用法：
    .workbuddy/binaries/python/envs/default/Scripts/python.exe tools/make-icon.py
"""
import math
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "desktop", "build")
OUT_ICO = os.path.join(OUT_DIR, "icon.ico")
OUT_PNG = os.path.join(OUT_DIR, "icon.png")

TEAL_TOP = (23, 107, 117)      # #176B75
TEAL_BOTTOM = (14, 76, 84)     # 深一档，做轻微竖向渐变
WHITE = (255, 255, 255, 255)

S = 2048          # 超采样画布
FINAL = 1024      # 输出主尺寸
RADIUS = int(S * 0.225)   # 圆角比例（和站点 --radius 的观感一致）


def rounded_gradient_base():
    """圆角方块底 + 自上而下的轻微青绿渐变（逐行画线）。"""
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=RADIUS, fill=255)
    grad = Image.new("RGBA", (S, S))
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        t = y / (S - 1)
        c = tuple(int(TEAL_TOP[i] + (TEAL_BOTTOM[i] - TEAL_TOP[i]) * t) for i in range(3)) + (255,)
        gd.line([(0, y), (S, y)], fill=c)
    img.paste(grad, (0, 0), mask)
    return img


def draw_bars(d):
    """三根上升的白色圆角柱（底部对齐，整体压低给折线让位）。"""
    m = S * 0.17                 # 内边距
    bottom = S - m
    bw = S * 0.105               # 柱宽
    gap = S * 0.075
    heights = [S * 0.13, S * 0.21, S * 0.29]
    x = m
    for h in heights:
        top = bottom - h
        d.rounded_rectangle([x, top, x + bw, bottom], radius=int(bw * 0.42), fill=WHITE)
        x += bw + gap
    return bottom


def draw_trend(d, bottom):
    """在柱子上方走位的上扬折线 + 箭头——和柱子分层，不穿过。"""
    pts = [
        (S * 0.20, S * 0.50),
        (S * 0.40, S * 0.40),
        (S * 0.58, S * 0.44),
        (S * 0.82, S * 0.26),
    ]
    w = int(S * 0.048)
    # 折线（圆头：手动画每段端点圆）
    for i in range(len(pts) - 1):
        d.line([pts[i], pts[i + 1]], fill=WHITE, width=w)
    for p in pts:
        r = w / 2
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=WHITE)
    # 箭头（指向右上）
    tip = (S * 0.885, S * 0.215)
    ang = math.atan2(pts[-1][1] - pts[-2][1], pts[-1][0] - pts[-2][0])
    L, spread = S * 0.13, 0.46
    a1 = (tip[0] - L * math.cos(ang - spread), tip[1] - L * math.sin(ang - spread))
    a2 = (tip[0] - L * math.cos(ang + spread), tip[1] - L * math.sin(ang + spread))
    d.polygon([tip, a1, a2], fill=WHITE)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    img = rounded_gradient_base()
    d = ImageDraw.Draw(img)
    bottom = draw_bars(d)
    draw_trend(d, bottom)

    final = img.resize((FINAL, FINAL), Image.LANCZOS)
    final.save(OUT_PNG)
    final.save(
        OUT_ICO,
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("已生成：", OUT_ICO)
    print("        ", OUT_PNG)


if __name__ == "__main__":
    main()
