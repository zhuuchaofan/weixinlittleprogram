const test = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const pages = join(__dirname, '../miniprogram/pages');
const components = join(__dirname, '../miniprogram/components');
// 页面和组件的目录，例如 pages/home、components/draft-list
const folders = () => [
  ...readdirSync(pages).map((name) => ['pages', name, join(pages, name)]),
  ...readdirSync(components).map((name) => [
    'components',
    name,
    join(components, name),
  ]),
];

// docs/DESIGN.md：页面里颜色只用 app.wxss 的变量，白色（渐变卡片上的字和按钮）除外
test('页面和组件的 wxss 不写死颜色', () => {
  for (const [kind, name, dir] of folders()) {
    const css = readFileSync(join(dir, 'index.wxss'), 'utf8');
    for (const hex of css.match(/#[0-9a-fA-F]{3,8}\b/g) || [])
      assert.match(
        hex,
        /^#fff(fff)?$/i,
        `${kind}/${name}/index.wxss 写死了 ${hex}，请用 app.wxss 里的变量`,
      );
  }
});

// 小号按钮的字会偏上，统一用 .btn-small
test('不用 size="mini" 按钮', () => {
  for (const [kind, name, dir] of folders()) {
    const wxml = readFileSync(join(dir, 'index.wxml'), 'utf8');
    assert.doesNotMatch(
      wxml,
      /size="mini"/,
      `${kind}/${name}/index.wxml 用了 size="mini"，请改用 class="btn-small"`,
    );
  }
});

// 按主题换色的图标每套主题都要有（新增后运行 scripts/theme-icons.py）
test('页面用到的主题图标每套主题都有', () => {
  const themes = join(__dirname, '../miniprogram/images/themes');
  for (const [kind, name, dir] of folders()) {
    const wxml = readFileSync(join(dir, 'index.wxml'), 'utf8');
    for (const [, file] of wxml.matchAll(
      /\/images\/themes\/\{\{themeId\}\}\/([\w.-]+)/g,
    ))
      for (const theme of readdirSync(themes))
        assert.ok(
          readdirSync(join(themes, theme)).includes(file),
          `${kind}/${name} 用了 ${file}，images/themes/${theme} 里没有`,
        );
  }
});

// 微信开发者工具的 WXSS 编译器不认 `> :nth-child()` 这种没有标签或类名的子选择器，
// 会报 error at token ':' 并白屏；`>`、`+`、`~` 和空格后面的伪类前必须有标签或类名。
test('wxss 里伪类前面不能光秃秃', () => {
  const files = [join(__dirname, '../miniprogram/app.wxss')];
  for (const [, , dir] of folders()) files.push(join(dir, 'index.wxss'));
  for (const file of files) {
    let css;
    try {
      css = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    // 只看选择器部分（{ 之前），去掉注释
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{[^{}]*\}/g, '{}')
      .split('{}');
    for (const sel of selectors) {
      const bare = sel.match(/(^|[\s>+~,])\s*:[a-z-]+/);
      assert.equal(bare, null, `${file} 有没带标签或类名的伪类：${sel.trim()}`);
    }
  }
});

// WXML 里没有反斜杠转义：写 \' 会在上传时报 unexpected character `\`。
// 属性用双引号，里面的字符串直接写单引号。
test('wxml 里不能有反斜杠', () => {
  for (const [kind, name, dir] of folders()) {
    const wxml = readFileSync(join(dir, 'index.wxml'), 'utf8');
    assert.ok(!wxml.includes('\\'), `${kind}/${name}/index.wxml 里有反斜杠`);
  }
});
