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

// app.wxss 把按钮外边距清零（button:not([size='mini'])），页面里写 `.x { margin-top }` 对按钮不生效。
// 要写成 button.x:not([size='mini']) { … }，选择器比全局的高。
test('按钮的外边距规则选择器要压过全局的清零', () => {
  for (const [kind, name, dir] of folders()) {
    const wxml = readFileSync(join(dir, 'index.wxml'), 'utf8');
    const css = readFileSync(join(dir, 'index.wxss'), 'utf8');
    const classes = new Set();
    for (const tag of wxml.matchAll(/<button[^>]*?class="([^"{}]*)"/g))
      for (const name of tag[1].split(/\s+/)) if (name) classes.add(name);
    for (const cls of classes)
      for (const rule of css.matchAll(
        new RegExp(`^\\.${cls}\\s*\\{([^}]*)\\}`, 'gm'),
      ))
        assert.doesNotMatch(
          rule[1].replace(/margin:\s*0\s*;?/g, ''),
          /margin/,
          `${kind}/${name}/index.wxss 里 .${cls} 是按钮，margin 会被全局样式盖掉，请写成 button.${cls}:not([size='mini'])`,
        );
  }
});

// docs/DESIGN.md「11. AI 文案」：AI 内容的标识只有一种写法。
test('AI 标识统一写「AI 生成」', () => {
  for (const [kind, name, dir] of folders()) {
    const wxml = readFileSync(join(dir, 'index.wxml'), 'utf8');
    for (const [, text] of wxml.matchAll(/class="tag">(AI[^<]*)</g))
      assert.equal(
        text,
        'AI 生成',
        `${kind}/${name}/index.wxml 的 AI 标识写成了「${text}」`,
      );
    assert.doesNotMatch(
      wxml,
      /重新生成/,
      `${kind}/${name}/index.wxml：AI 的按钮统一叫「重新写」`,
    );
  }
});

// 出错后的按钮统一叫「再试一次」；勾选圈勾上是猫爪，不是 ✓。
test('页面里不写「重试」，勾选圈里不写 ✓', () => {
  for (const [kind, name, dir] of folders()) {
    const wxml = readFileSync(join(dir, 'index.wxml'), 'utf8');
    assert.doesNotMatch(
      wxml,
      /重试/,
      `${kind}/${name}/index.wxml 里有「重试」，请写「再试一次」`,
    );
    assert.doesNotMatch(
      wxml,
      /class="tick-box[^>]*>[^<]*✓/,
      `${kind}/${name}/index.wxml 的勾选圈里写了 ✓，请用 .tick-paw 猫爪`,
    );
  }
});

// docs/DESIGN.md「10. 保存、删除、返回」：编辑页保存 / 删除成功走 doneBack，不直接 navigateBack；
// 弹窗按钮最多 4 个字（微信的限制，超了真机会报错）。
test('编辑页保存后走统一反馈，弹窗按钮不超过 4 个字', () => {
  for (const [kind, name, dir] of folders()) {
    const ts = readFileSync(join(dir, 'index.ts'), 'utf8');
    if (name.endsWith('-edit') || name === 'budgets') {
      assert.match(ts, /doneBack\(/, `${kind}/${name} 保存后请用 doneBack()`);
      assert.doesNotMatch(
        ts,
        /wx\.navigateBack\(/,
        `${kind}/${name} 请用 doneBack()，不要直接 wx.navigateBack()`,
      );
    }
    for (const [, text] of ts.matchAll(/(?:confirm|cancel)Text: '([^']*)'/g))
      assert.ok(
        [...text].length <= 4,
        `${kind}/${name} 的弹窗按钮「${text}」超过 4 个字`,
      );
  }
});
