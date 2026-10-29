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
def paw(x,y,coat,rx=10,ry=6,r=0): return f'<ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}" transform="rotate({r} {x} {y})" fill="{COATS[coat]["fill"]}" stroke="{T["line"]}" stroke-width="1.6"/>'
def zz(x,y): return f'<path d="M{x} {y} h8 l-8 8 h8 M{x+12} {y-10} h6 l-6 6 h6" fill="none" stroke="{T["accent"]}" stroke-opacity="0.5" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'
POSES={
 'peek':  ('探头', lambda c: head(80,50,1,0,'open',c)+paw(56,70,c)+paw(104,70,c)),
 'sleep': ('趴着睡', lambda c: tail('M128 64 C146 66 146 82 132 86',c)+body('M44 72 C44 50 70 42 96 42 C124 42 138 54 136 72 Z',c)+head(58,50,.78,-8,'closed',c)+zz(96,22)),
 'sit':   ('坐着', lambda c: tail('M98 68 C118 70 122 52 112 42',c,7)+body('M58 72 C54 48 66 34 80 32 C94 34 106 48 102 72 Z',c)+head(80,24,.82,0,'open',c)+f'<path d="M72 72 V60 M88 72 V60" stroke="{T["line"]}" stroke-width="1.8" stroke-linecap="round"/>'),
 'stretch':('伸懒腰', lambda c: tail('M132 36 C140 22 150 18 150 8',c,7)+body('M34 72 C34 64 46 62 62 62 C84 60 104 40 124 32 C140 28 144 50 138 72 Z',c)+paw(22,69,c,11,5)+paw(36,70,c,11,5)+head(58,48,.72,-14,'closed',c)),
 'wash':  ('洗脸', lambda c: tail('M98 68 C118 70 122 52 112 42',c,7)+body('M58 72 C54 48 66 34 80 32 C94 34 106 48 102 72 Z',c)+head(80,24,.82,6,'closed',c)+paw(66,30,c,7,10,-25)),
 'hang':  ('扒边垂爪', lambda c: body('M42 66 C42 48 60 42 80 42 C100 42 118 48 118 66 Z',c)+tail('M114 62 C134 60 140 46 134 36',c,7)+head(80,42,.86,-6,'open',c)+paw(68,74,c,7,10)+paw(92,74,c,7,10)),
}
SH=f'<defs><filter id="s" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1" stdDeviation="2.4" flood-color="rgb({T["tint"]})" flood-opacity="0.16"/></filter></defs>'
def svg(pose,coat): return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -20 160 110">{SH}{POSES[pose][1](coat)}</svg>'


# 第 n 张卡片用哪只猫（按顺序轮流）：姿势、毛色
ORDER = [('peek', 'white'), ('sleep', 'orange'), ('sit', 'grey'), ('stretch', 'white'), ('wash', 'cow'), ('hang', 'orange')]
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
