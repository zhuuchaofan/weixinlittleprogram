import { DEFAULT_THEME, THEMES, type Theme } from '../config/themes';

/** 主题存在本机：两个人可以各用各的。 */
const KEY = 'theme';

let current: Theme | null = null;

export function currentTheme(): Theme {
  if (current) return current;
  let id = '';
  try {
    id = String(wx.getStorageSync(KEY) || '');
  } catch {
    /* 读不到就用默认主题 */
  }
  current = THEMES.find((item) => item.id === id) || DEFAULT_THEME;
  return current;
}

export function setTheme(id: string): Theme {
  current = THEMES.find((item) => item.id === id) || DEFAULT_THEME;
  try {
    wx.setStorageSync(KEY, current.id);
  } catch {
    /* 存不下也不影响本次使用 */
  }
  return current;
}

function styleOf(theme: Theme): string {
  return Object.entries(theme.vars)
    .map(([name, value]) => `${name}: ${value}`)
    .join('; ');
}

/** 页面 data 的初始值：首屏就用本机选的主题，不用等 onShow。 */
export function themeData(): {
  themeStyle: string;
  themeId: string;
  accent: string;
} {
  const theme = currentTheme();
  return {
    themeStyle: styleOf(theme),
    themeId: theme.id,
    accent: theme.accent,
  };
}

type ThemedPage = {
  data: Record<string, unknown>;
  setData(data: Record<string, unknown>): void;
};

/**
 * 每个页面 onShow 时调用：把主题变量放进 data.themeStyle（wxml 顶部的 page-meta 用），
 * 主色放进 data.accent（开关的 color 用），themeId 用来选 images/themes/<id>/ 下换过色的图标，并设置导航栏颜色。从设置页换完主题返回时也会刷新。
 */
export function applyTheme(page: ThemedPage): void {
  const theme = currentTheme();
  const themeStyle = styleOf(theme);
  if (page.data.themeStyle !== themeStyle)
    page.setData({ themeStyle, themeId: theme.id, accent: theme.accent });
  wx.setNavigationBarColor({
    frontColor: '#000000',
    backgroundColor: theme.paper,
    fail: () => undefined,
  });
  wx.setBackgroundColor?.({
    backgroundColor: theme.paper,
    fail: () => undefined,
  });
}
