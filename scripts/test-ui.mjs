import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  executablePath:
    process.env.BROWSER_PATH ||
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
mkdirSync('artifacts/ui', { recursive: true });
const results = [];
const errors = [];
const page = await browser.newPage();
const previewUrl = process.env.PREVIEW_URL || 'http://127.0.0.1:4173';
page.on('pageerror', (error) => errors.push(error.message));
page.on('dialog', (dialog) => dialog.accept());
async function visit(name) {
  await page.goto(`${previewUrl}/#${name}`);
  await page.waitForSelector(`body[data-ready="${name}"]`);
  if (['rsvp', 'admin'].includes(name))
    await page.waitForFunction(() => !window.__page.data.loading);
}
async function check(name, action) {
  await action();
  results.push(name);
  console.log('PASS', name);
}
try {
  for (const [width, height] of [
    [320, 667],
    [360, 800],
    [393, 852],
    [430, 932],
    [1280, 900],
  ]) {
    await page.setViewportSize({ width, height });
    for (const name of [
      'home',
      'invitation',
      'story',
      'gallery',
      'rsvp',
      'admin',
      'privacy',
    ]) {
      await visit(name);
      await check(`${width}px / ${name} 横向无溢出、可滚动到底`, async () => {
        const layout = await page.evaluate(() => {
          window.scrollTo(0, document.documentElement.scrollHeight);
          return {
            width: document.documentElement.scrollWidth,
            viewport: innerWidth,
            height: document.documentElement.scrollHeight,
          };
        });
        assert.ok(layout.width <= width + 1, JSON.stringify(layout));
        const footer = page.locator('page-footer');
        await footer.scrollIntoViewIfNeeded();
        assert.ok(await footer.isVisible());
      });
      if (width === 393 || width === 360) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: `artifacts/ui/${width}-${name}.png`,
          fullPage: true,
        });
      }
    }
  }
  await page.setViewportSize({ width: 393, height: 852 });
  await visit('home');
  await check('猫咪彩蛋展开、首页导航进入相册', async () => {
    await page.getByText('球球与布丁，也在等你来。').click();
    assert.ok(await page.locator('.cat-reveal').isVisible());
    await page.getByRole('button', { name: /翻开我们的纪念册/ }).click();
    await page.waitForSelector('body[data-ready="gallery"]');
  });
  await check('相册切组与大图前后翻页', async () => {
    await page.locator('.tab').first().click();
    assert.equal(await page.locator('.tile').count(), 8);
    await page
      .locator('photo-frame')
      .first()
      .evaluate((host) => {
        host.__component.open();
      });
    await page.getByRole('dialog').waitFor();
    assert.ok(await page.getByRole('dialog').isVisible());
    await page.getByRole('button', { name: '下一张', exact: true }).click();
    assert.match(await page.getByRole('dialog').innerText(), /2 \/ 8/);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
  });
  await visit('rsvp');
  await check('空表校验、未同意隐私禁止提交', async () => {
    await page.locator('.primary').click();
    assert.match(await page.locator('.error').innerText(), /称呼/);
    await page.locator('#guest-name').fill('测试亲友');
    await page.locator('.primary').click();
    assert.match(await page.locator('.error').innerText(), /隐私/);
  });
  await check('人数加减、保存、回读、更新去重与后台汇总', async () => {
    await page.getByLabel('增加一人', { exact: true }).click();
    await page.locator('input[type=checkbox]').check();
    await page.locator('#guest-note').fill('一位素食');
    await page.locator('.primary').click();
    await page.waitForFunction(() => window.__page.data.saved);
    assert.equal(await page.evaluate(() => window.__page.data.partySize), 2);
    await visit('rsvp');
    assert.equal(await page.locator('#guest-name').inputValue(), '测试亲友');
    await page.getByLabel('增加一人', { exact: true }).click();
    await page.locator('.primary').click();
    await page.waitForFunction(() => window.__page.data.saved);
    await visit('admin');
    assert.equal(await page.locator('.guest').count(), 1);
    assert.equal(
      await page.evaluate(() => window.__page.data.summary.guests),
      3,
    );
  });
  await check('无法到场自动归零、存储失败保留表单并可重试', async () => {
    await visit('rsvp');
    await page.getByRole('button', { name: '遥寄祝福', exact: true }).click();
    await page.evaluate(() => {
      window.__failStorage = true;
    });
    await page.locator('.primary').click();
    await page.waitForSelector('.error');
    assert.equal(await page.locator('#guest-name').inputValue(), '测试亲友');
    await page.evaluate(() => {
      window.__failStorage = false;
    });
    await page.locator('.primary').click();
    await page.waitForFunction(() => window.__page.data.saved);
    await visit('admin');
    assert.equal(
      await page.evaluate(() => window.__page.data.summary.guests),
      0,
    );
  });
  await check('隐私页删除登记后后台为空', async () => {
    await visit('privacy');
    await page
      .getByRole('button', { name: '删除我的本机演示登记', exact: true })
      .click();
    await page.waitForFunction(() =>
      window.__page.data.message.includes('已删除'),
    );
    await visit('admin');
    assert.ok(await page.locator('.empty').isVisible());
  });
  await check('相册和故事空状态', async () => {
    await visit('gallery');
    await page.evaluate(() =>
      window.__page.setData({
        columns: [
          { id: 'left', photos: [] },
          { id: 'right', photos: [] },
        ],
        total: 0,
      }),
    );
    assert.ok(await page.locator('.empty').isVisible());
    await page.screenshot({
      path: 'artifacts/ui/gallery-empty.png',
      fullPage: true,
    });
    await visit('story');
    await page.evaluate(() => window.__page.setData({ storyItems: [] }));
    assert.ok(await page.locator('.empty').isVisible());
  });
  await check('图片失败占位、重试、恢复可见', async () => {
    await visit('home');
    await page.evaluate(() =>
      window.__page.setData({
        coverPhoto: {
          thumbnail: '/assets/missing.png',
          caption: '故障测试照片',
          placeholder: false,
        },
      }),
    );
    await page.locator('photo-frame').evaluate((host) => {
      host.__component.error();
    });
    assert.equal(
      await page.evaluate(
        () => document.querySelector('photo-frame').__component.data.failed,
      ),
      true,
    );
    await page.screenshot({
      path: 'artifacts/ui/photo-failure.png',
      fullPage: true,
    });
    await page.locator('photo-frame').evaluate((host) => {
      host.__component.retry();
    });
    await page.evaluate(() =>
      window.__page.setData({
        coverPhoto: {
          thumbnail: '/assets/placeholder-portrait.png',
          caption: '恢复测试',
          placeholder: false,
        },
      }),
    );
    await page.locator('photo-frame').evaluate((host) => {
      host.__component.load();
    });
    assert.equal(
      await page.evaluate(
        () => document.querySelector('photo-frame').__component.data.failed,
      ),
      false,
    );
  });
  await check('减少动效设置保持、深色偏好下保持奶油色与可读文字', async () => {
    await visit('privacy');
    await page.locator('input[type=checkbox]').uncheck();
    await visit('home');
    assert.ok(await page.locator('.entrance').count());
    await visit('privacy');
    await page.locator('input[type=checkbox]').check();
    await visit('home');
    assert.equal(await page.locator('.entrance').count(), 0);
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    assert.equal(
      await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      ),
      'rgb(247, 242, 233)',
    );
    await page.screenshot({
      path: 'artifacts/ui/dark-reduced-motion.png',
      fullPage: true,
    });
  });
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(
    'artifacts/ui/results.json',
    JSON.stringify(
      {
        tool: 'Playwright / Edge, 原生模板适配预览，非微信基础库',
        passed: results.length,
        results,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  await browser.close();
}
