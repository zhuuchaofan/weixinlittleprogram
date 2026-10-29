"""白卡片、列表右上角趴着的小猫（6 种姿势 × 毛色），写进 miniprogram/app.wxss 的 card-cats 段。

小猫不跟主题变色（白 / 橘白 / 灰 / 奶牛，粉色内耳和腮红），所以直接放在 app.wxss 里，页面不用多传。
改了姿势或毛色后运行：python3 scripts/card-cats.py
"""
import base64
import pathlib

APP = pathlib.Path(__file__).resolve().parent.parent / 'miniprogram' / 'app.wxss'
T = dict(tint='90, 80, 110', soft='#fadbe2', accent='#e98aa2', ink='#3b3440', line='#ece8ef')
COATS={'white':dict(fill='#ffffff',patch=None),'orange':dict(fill='#ffffff',patch='#f5b770'),'grey':dict(fill='#e9e6ee',patch='#c4bdcf'),'cow':dict(fill='#ffffff',patch='#4a4356')}
HEAD="M-40 6 C-44 -8 -38 -18 -29 -22 L-31 -40 Q-30 -45 -25 -42 L-8 -31 Q0 -33 8 -31 L25 -42 Q30 -45 31 -40 L29 -22 C38 -18 44 -8 40 6 C36 24 -36 24 -40 6 Z"
def head(x,y,s=1,r=0,eyes='open',coat='white',hid='h'):
    c=COATS[coat]; t=f'translate({x} {y}) rotate({r}) scale({s})'
    patch=''
    if c['patch']:
        p={'orange':'M-50 -50 H-2 C0 -30 -6 -14 -24 -12 C-38 -11 -46 -20 -50 -24 Z','grey':'M-7 -33 Q-6 -24 -5 -18 M0 -34 V-17 M7 -33 Q6 -24 5 -18','cow':'M10 -50 H50 V-20 C40 -14 26 -16 18 -22 C12 -28 10 -40 10 -50 Z'}[coat]
        patch=(f'<path d="{p}" fill="none" stroke="{c["patch"]}" stroke-width="3" stroke-linecap="round"/>' if coat=='grey' else f'<clipPath id="{hid}c"><path d="{HEAD}"/></clipPath><path d="{p}" fill="{c["patch"]}" clip-path="url(#{hid}c)"/>')
    e=(f'<circle cx="-13" cy="-6" r="3.6" fill="{T["ink"]}"/><circle cx="13" cy="-6" r="3.6" fill="{T["ink"]}"/>' if eyes=='open' else
       f'<path d="M-18 -6 Q-13 -1 -8 -6 M8 -6 Q13 -1 18 -6" fill="none" stroke="{T["ink"]}" stroke-width="2.6" stroke-linecap="round"/>')
    return (f'<g transform="{t}"><path d="{HEAD}" fill="{c["fill"]}" filter="url(#s)"/>{patch}'
      f'<path d="M-25 -36 L-14 -28 L-23 -23 Z M25 -36 L14 -28 L23 -23 Z" fill="{T["soft"]}"/>'
      f'<ellipse cx="-23" cy="3" rx="6" ry="3.4" fill="{T["accent"]}" fill-opacity="0.18"/><ellipse cx="23" cy="3" rx="6" ry="3.4" fill="{T["accent"]}" fill-opacity="0.18"/>'
      f'{e}<path d="M-4 1 Q-2 4 0 1.5 Q2 4 4 1" fill="none" stroke="{T["accent"]}" stroke-width="2" stroke-linecap="round"/></g>')
def body(d,coat): return f'<path d="{d}" fill="{COATS[coat]["fill"]}" filter="url(#s)"/>'
def tail(d,coat,w=8): return f'<path d="{d}" fill="none" stroke="{COATS[coat]["fill"]}" stroke-width="{w}" stroke-linecap="round" filter="url(#s)"/>'
def zz(x,y): return f'<path d="M{x} {y} h8 l-8 8 h8 M{x+12} {y-10} h6 l-6 6 h6" fill="none" stroke="{T["accent"]}" stroke-opacity="0.5" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'
def fillet(x1,x2,coat,r=9):  # 身子和卡片边的接缝：两边向外的圆弧，像从卡片里长出来；不加阴影
    return f'<path d="M{x1-r} 70 Q{x1} 70 {x1} {70-r} H{x2} Q{x2} 70 {x2+r} 70 Z" fill="{COATS[coat]["fill"]}"/>'
# 每种姿势：名字、画法、身子落在卡片边上的左右两端（y=70 是卡片上边）
SIT='M58 70 C54 48 66 34 80 32 C94 34 106 48 102 70 Z'
POSES={
 'peek':  ('探头', lambda c: body('M58 70 C58 62 64 58 72 58 H88 C96 58 102 62 102 70 Z',c)+head(80,48,1,0,'open',c), (60,100)),
 'sleep': ('趴着睡', lambda c: tail('M128 64 C146 62 150 46 140 38',c)+body('M44 70 C44 50 70 42 96 42 C124 42 138 54 136 70 Z',c)+head(58,50,.78,-8,'closed',c)+zz(96,22), (46,134)),
 'sit':   ('坐着', lambda c: tail('M98 66 C118 68 122 52 112 42',c,7)+body(SIT,c)+head(80,24,.82,0,'open',c), (58,102)),
 'stretch':('伸懒腰', lambda c: tail('M132 36 C140 22 150 18 150 8',c,7)+body('M30 70 C30 62 44 60 62 60 C84 58 104 40 124 32 C140 28 144 50 138 70 Z',c)+head(54,48,.72,-14,'closed',c), (32,136)),
 'tilt':  ('歪头眯眼', lambda c: tail('M98 66 C118 68 122 52 112 42',c,7)+body(SIT,c)+head(78,24,.82,-12,'closed',c), (58,102)),
 'hang':  ('趴在边上', lambda c: tail('M120 58 C138 56 144 40 136 30',c,7)+body('M60 70 C60 50 86 44 106 46 C124 48 130 58 128 70 Z',c)+head(66,53,.82,-8,'open',c), (62,126)),
}
SH=(f'<defs><filter id="s" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="-0.5" stdDeviation="2.4" flood-color="rgb({T["tint"]})" flood-opacity="0.16"/></filter>'
    '<clipPath id="edge"><rect x="0" y="-20" width="160" height="90"/></clipPath></defs>')
def svg(pose,coat):
    _, draw, (x1, x2) = POSES[pose]
    # 阴影只留在卡片上边以上，接缝处不出现一道灰线
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -20 160 110">{SH}<g clip-path="url(#edge)">{draw(coat)}{fillet(x1,x2,coat)}</g></svg>'


# 第 n 张卡片用哪只猫（按顺序轮流）：姿势、毛色
ORDER = [('peek', 'white'), ('sleep', 'orange'), ('sit', 'grey'), ('stretch', 'white'), ('tilt', 'cow'), ('hang', 'orange')]
START = '/* card-cats:start（scripts/card-cats.py 生成，别手改） */'
END = '/* card-cats:end */'


def css():
    lines = [START]
    for i, (pose, coat) in enumerate(ORDER, 1):
        data = base64.b64encode(svg(pose, coat).encode()).decode()
        lines.append(f"page {{ --card-cat-{i}: url('data:image/svg+xml;base64,{data}'); }}")
    n = len(ORDER)
    for i in range(2, n + 1):
        lines.append(f'.card:nth-child({n}n+{i})::before, .list:nth-child({n}n+{i})::before, .grid-cell:nth-child({n}n+{i})::before {{ background-image: var(--card-cat-{i}); }}')
    lines.append(END)
    return '\n'.join(lines)


def main():
    text = APP.read_text(encoding='utf-8')
    start, end = text.index(START), text.index(END) + len(END)
    APP.write_text(text[:start] + css() + text[end:], encoding='utf-8')
    print('写好了', len(ORDER), '只')


if __name__ == '__main__':
    main()
