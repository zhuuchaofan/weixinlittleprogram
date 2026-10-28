/** 主题色：每套一组 CSS 变量，页面通过 <page-meta page-style> 套用。app.wxss 里的默认值就是默认主题（香芋紫）。 */
export interface Theme {
  id: string;
  name: string;
  /** 设置页色块用的渐变。 */
  swatch: string;
  /** 开关等组件的颜色属性（不能用 CSS 变量）。 */
  accent: string;
  /** 导航栏和下拉背景色，同 --paper。 */
  paper: string;
  vars: Record<string, string>;
}

function theme(
  id: string,
  name: string,
  c: {
    paper: string;
    sunken: string;
    ink: string;
    muted: string;
    line: string;
    accent: string;
    soft: string;
    grad: [string, string, string];
    ring: string;
    /** 主色的 r, g, b，用来生成主色阴影。 */
    glow: string;
    /** 卡片阴影的 r, g, b。 */
    tint: string;
    avatarB: [string, string];
  },
): Theme {
  const grad = `linear-gradient(135deg, ${c.grad[0]} 0%, ${c.grad[1]} 55%, ${c.grad[2]} 100%)`;
  // 卡片右上角的猫耳朵（app.wxss 的 .card::before）：白耳朵、浅主色内耳。不加引号，page-style 里放得下
  const ears = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 34"><path d="M2 34 L16 7 Q20 0 25 6 L44 34 Z" fill="#ffffff"/><path d="M13 34 L20 16 L32 34 Z" fill="${c.soft}"/><path d="M56 34 L75 6 Q80 0 84 7 L98 34 Z" fill="#ffffff"/><path d="M68 34 L80 16 L87 34 Z" fill="${c.soft}"/></svg>`;
  return {
    id,
    name,
    swatch: grad,
    accent: c.accent,
    paper: c.paper,
    vars: {
      '--paper': c.paper,
      '--sunken': c.sunken,
      '--ink': c.ink,
      '--muted': c.muted,
      '--line': c.line,
      '--accent': c.accent,
      '--accent-soft': c.soft,
      '--card-ears': `url(data:image/svg+xml,${encodeURIComponent(ears)})`,
      '--accent-grad': grad,
      '--ring': c.ring,
      '--glow': `rgba(${c.glow}, 0.28)`,
      '--tint': `rgba(${c.tint}, 0.14)`,
      '--shadow': `0 8rpx 32rpx rgba(${c.tint}, 0.08)`,
      '--avatar-a': `linear-gradient(135deg, ${c.grad[0]}, ${c.grad[1]})`,
      '--avatar-b': `linear-gradient(135deg, ${c.avatarB[0]}, ${c.avatarB[1]})`,
    },
  };
}

export const THEMES: Theme[] = [
  theme('peach', '蜜桃橙', {
    paper: '#fff7f3',
    sunken: '#f7ede8',
    ink: '#2b2220',
    muted: '#8f817b',
    line: '#f1e5de',
    accent: '#f2614f',
    soft: '#ffece5',
    grad: ['#ff8f4a', '#ff6a5c', '#f9578a'],
    ring: '#ffb39e',
    glow: '242, 97, 79',
    tint: '176, 96, 64',
    avatarB: ['#8b7cf6', '#6c8cff'],
  }),
  theme('matcha', '抹茶绿', {
    paper: '#f4f8f1',
    sunken: '#e8efe3',
    ink: '#1f2a22',
    muted: '#7b8a7f',
    line: '#e1eadb',
    accent: '#3a9a68',
    soft: '#e2f2e7',
    grad: ['#9fd47c', '#4cb57f', '#2f9c96'],
    ring: '#a8d9b9',
    glow: '58, 154, 104',
    tint: '70, 110, 80',
    avatarB: ['#f2b25c', '#e98a4f'],
  }),
  theme('mist', '雾霾蓝', {
    paper: '#f3f6fb',
    sunken: '#e7ecf5',
    ink: '#1e2533',
    muted: '#7d8698',
    line: '#e0e6f0',
    accent: '#4b7bd8',
    soft: '#e5edfb',
    grad: ['#86c0ff', '#5b8cf0', '#7b6cf0'],
    ring: '#b2c8f2',
    glow: '75, 123, 216',
    tint: '70, 90, 140',
    avatarB: ['#ff9ab0', '#f5728f'],
  }),
  theme('latte', '奶咖', {
    paper: '#faf6f0',
    sunken: '#f0e8de',
    ink: '#2e251e',
    muted: '#8f8276',
    line: '#ece2d6',
    accent: '#b0784a',
    soft: '#f5e9dc',
    grad: ['#e3b77e', '#c68a58', '#a8684c'],
    ring: '#e0c2a2',
    glow: '176, 120, 74',
    tint: '140, 100, 60',
    avatarB: ['#8fb59a', '#5f9a7a'],
  }),
  theme('taro', '香芋紫', {
    paper: '#f8f5fc',
    sunken: '#eee8f6',
    ink: '#26203a',
    muted: '#8a8299',
    line: '#e9e2f2',
    accent: '#8a5fd6',
    soft: '#efe7fb',
    grad: ['#c8a2f7', '#9a72ea', '#e785c0'],
    ring: '#cfb8f2',
    glow: '138, 95, 214',
    tint: '110, 80, 150',
    avatarB: ['#7cc4f2', '#5b9cf0'],
  }),
];

export const DEFAULT_THEME =
  THEMES.find((item) => item.id === 'taro') || THEMES[0];
