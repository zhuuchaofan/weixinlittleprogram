const test = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const pages = join(__dirname, '../miniprogram/pages');

// docs/DESIGN.md：页面里颜色只用 app.wxss 的变量，白色（渐变卡片上的字和按钮）除外
test('页面 wxss 不写死颜色', () => {
  for (const name of readdirSync(pages)) {
    const css = readFileSync(join(pages, name, 'index.wxss'), 'utf8');
    for (const hex of css.match(/#[0-9a-fA-F]{3,8}\b/g) || [])
      assert.match(
        hex,
        /^#fff(fff)?$/i,
        `pages/${name}/index.wxss 写死了 ${hex}，请用 app.wxss 里的变量`,
      );
  }
});

// 小号按钮的字会偏上，统一用 .btn-small
test('不用 size="mini" 按钮', () => {
  for (const name of readdirSync(pages)) {
    const wxml = readFileSync(join(pages, name, 'index.wxml'), 'utf8');
    assert.doesNotMatch(
      wxml,
      /size="mini"/,
      `pages/${name}/index.wxml 用了 size="mini"，请改用 class="btn-small"`,
    );
  }
});
