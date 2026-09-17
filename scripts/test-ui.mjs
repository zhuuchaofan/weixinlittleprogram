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
  if (['rsvp', 'admin', 'photos'].includes(name))
    await page.waitForFunction(
      () => !window.__page.data.loading && !window.__page.data.busy,
    );
  if (['home', 'gallery', 'story'].includes(name))
    await page.waitForFunction(() => window.__page.data.photoContentReady);
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
      'photos',
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
  await check('照片组件同源返回不重置，新图预加载成功后才切换', async () => {
    await page.waitForFunction(
      () => document.querySelector('photo-frame')?.__component?.data.loaded,
    );
    const result = await page
      .locator('photo-frame')
      .first()
      .evaluate(async (host) => {
        const component = host.__component;
        const original = component.data.currentSource;
        component.receive(original);
        const sameSource = {
          loaded: component.data.loaded,
          currentSource: component.data.currentSource,
        };

        const replacement = '/assets/placeholder-landscape.png';
        component.data.src = replacement;
        await component.stage(replacement, false);
        const waiting = {
          currentSource: component.data.currentSource,
          pendingSource: component.data.pendingSource,
          loaded: component.data.loaded,
          failed: component.data.failed,
        };
        component.load();
        const switched = {
          currentSource: component.data.currentSource,
          pendingSource: component.data.pendingSource,
          loaded: component.data.loaded,
        };

        const failingReplacement = '/assets/placeholder-square.png';
        component.data.src = failingReplacement;
        await component.stage(failingReplacement, false);
        component.error();
        return {
          original,
          sameSource,
          waiting,
          switched,
          afterFailure: {
            currentSource: component.data.currentSource,
            pendingSource: component.data.pendingSource,
            loaded: component.data.loaded,
            failed: component.data.failed,
          },
        };
      });
    assert.deepEqual(result.sameSource, {
      loaded: true,
      currentSource: result.original,
    });
    assert.deepEqual(result.waiting, {
      currentSource: result.original,
      pendingSource: '/assets/placeholder-landscape.png',
      loaded: true,
      failed: false,
    });
    assert.deepEqual(result.switched, {
      currentSource: '/assets/placeholder-landscape.png',
      pendingSource: '',
      loaded: true,
    });
    assert.deepEqual(result.afterFailure, {
      currentSource: '/assets/placeholder-landscape.png',
      pendingSource: '',
      loaded: true,
      failed: false,
    });
  });
  await check('照片安排不变不重设页面，读取失败保留当前内容', async () => {
    await visit('home');
    const result = await page.evaluate(async () => {
      const page = window.__page;
      const originalSetData = page.setData.bind(page);
      let photoUpdates = 0;
      page.setData = (patch) => {
        if ('coverPhoto' in patch || 'catPhotos' in patch) photoUpdates++;
        return originalSetData(patch);
      };
      await page.onShow();
      const unchangedUpdates = photoUpdates;
      const signature = page.data.photoSignature;
      const originalGetStorageSync = window.wx.getStorageSync;
      window.wx.getStorageSync = (key) => {
        if (key === 'photos:published') throw new Error('模拟读取失败');
        return originalGetStorageSync(key);
      };
      await page.onShow();
      window.wx.getStorageSync = originalGetStorageSync;
      page.setData = originalSetData;
      return {
        unchangedUpdates,
        unavailableUpdates: photoUpdates - unchangedUpdates,
        signature,
        ready: page.data.photoContentReady,
      };
    });
    assert.equal(result.unchangedUpdates, 0);
    assert.equal(result.unavailableUpdates, 0);
    assert.ok(result.ready && result.signature);
  });
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
    assert.match(
      await page.locator('.record-time').innerText(),
      /^提交于 \d{4}年\d{1,2}月\d{1,2}日 \d{2}:\d{2}$/,
    );
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
  await check('首次加载失败显示提示，重试后可恢复展示', async () => {
    await visit('home');
    const result = await page
      .locator('photo-frame')
      .first()
      .evaluate(async (host) => {
        const component = host.__component;
        component.receive('');
        component.data.src = '/assets/missing.png';
        await component.stage(component.data.src, true);
        component.error();
        const failed = component.data.failed;
        component.retry();
        component.data.src = '/assets/placeholder-portrait.png';
        await component.stage(component.data.src, true);
        component.load();
        return {
          failed,
          recovered: component.data.loaded && !component.data.failed,
        };
      });
    assert.equal(result.failed, true);
    assert.equal(result.recovered, true);
    await page.screenshot({
      path: 'artifacts/ui/photo-failure-recovered.png',
      fullPage: true,
    });
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
  await check('照片草稿编辑、复用、排序、发布及首页相册读取', async () => {
    await visit('photos');
    assert.equal(
      await page.evaluate(() => window.__page.data.authorized),
      true,
    );
    await page.evaluate(async () => {
      const p = window.__page;
      p.caption({
        currentTarget: { dataset: { index: 0 } },
        detail: { value: '测试照片说明' },
      });
      p.duplicate({ currentTarget: { dataset: { index: 0 } } });
      p.slot({
        currentTarget: { dataset: { index: p.data.photos.length - 1 } },
        detail: { value: '3' },
      });
      p.move({ currentTarget: { dataset: { index: 1, delta: -1 } } });
      await p.save();
    });
    await visit('photos');
    assert.equal(
      await page.evaluate(() => window.__page.data.photos.at(-1).slot),
      'qiuqiu',
    );
    await page.evaluate(() => window.__page.persist(true));
    await visit('home');
    await page.waitForFunction(() =>
      window.__page.data.catPhotos.some((p) => p.slot === 'qiuqiu'),
    );
    await visit('gallery');
    await page.waitForFunction(() =>
      window.__page.data.albums[0].photos.some(
        (p) => p.caption === '测试照片说明',
      ),
    );
    await visit('photos');
    await page.evaluate(async () => {
      window.__page.setData({ photos: [] });
      await window.__page.persist(true);
    });
    await visit('gallery');
    await page.waitForFunction(() => window.__page.data.total === 0);
    assert.ok(await page.locator('.empty').isVisible());
  });
  await check(
    '遗留云图导入自动保存，重新进入仍可见且不会自动发布',
    async () => {
      await visit('photos');
      await page.evaluate(async () => {
        window.__page.setData({
          importId: 'cloud://test-env/wedding/managed/recovered.jpg',
        });
        await window.__page.importPhoto();
      });
      await visit('photos');
      assert.ok(
        await page.evaluate(() =>
          window.__page.data.photos.some(
            (p) =>
              p.original === 'cloud://test-env/wedding/managed/recovered.jpg',
          ),
        ),
      );
      await visit('gallery');
      await page.waitForFunction(() => window.__page.data.total === 0);
    },
  );
  await check('猫咪照片为空或只发布一只时分别保留占位', async () => {
    await visit('home');
    await page.waitForFunction(
      () =>
        window.__page.data.catPhotos.length === 2 &&
        window.__page.data.catPhotos.every((p) => p.placeholder),
    );
    await visit('photos');
    await page.evaluate(async () => {
      const p = window.__page;
      p.setData({ photos: [{ ...p.data.photos[0], slot: 'qiuqiu' }] });
      await p.persist(true);
    });
    await visit('home');
    await page.waitForFunction(() =>
      window.__page.data.catPhotos.some((p) => p.slot === 'qiuqiu'),
    );
    assert.ok(
      await page.evaluate(() =>
        window.__page.data.catPhotos.some(
          (p) => p.id === 'buding' && p.placeholder,
        ),
      ),
    );
  });
  await check('四张猫咪照片在手机上固定两列，名字清晰可见', async () => {
    await visit('home');
    await page.evaluate(async () => {
      await window.__page.onShow();
      const catPhotos = Array.from({ length: 4 }, (_, i) => ({
        id: 'layout-' + i,
        slot: i === 0 ? 'qiuqiu' : 'buding',
        thumbnail: '',
        original: '',
        placeholder: true,
        caption: '',
        ratio: i === 2 ? 'portrait' : 'landscape',
      }));
      window.__page.setData({
        catVisible: true,
        catPhotos,
        catColumns: [
          { id: 'cat-column-0', photos: [catPhotos[0], catPhotos[2]] },
          { id: 'cat-column-1', photos: [catPhotos[1], catPhotos[3]] },
        ],
      });
    });
    for (const width of [320, 393, 430]) {
      await page.setViewportSize({ width, height: 852 });
      const boxes = await page.locator('.cat-photo').evaluateAll((nodes) =>
        nodes.map((n) => {
          const r = n.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width };
        }),
      );
      assert.equal(boxes.length, 4);
      assert.ok(Math.abs(boxes[0].y - boxes[2].y) < 1);
      assert.ok(boxes[1].y > boxes[0].y);
      assert.ok(Math.abs(boxes[0].x - boxes[1].x) < 1);
      assert.ok(boxes[2].x + boxes[2].width <= width);
    }
    assert.deepEqual(await page.locator('.cat-caption').allTextContents(), [
      '球球',
      '布丁',
      '布丁',
      '布丁',
    ]);
    await page
      .locator('.cat-reveal')
      .screenshot({ path: 'artifacts/ui/cats-two-columns.png' });
  });
  await check('正式隐私与故事页面不显示演示或排版示例文案', async () => {
    await visit('privacy');
    await page.evaluate(() => window.__page.setData({ isMock: false }));
    const privacy = await page.locator('.page').innerText();
    assert.doesNotMatch(privacy, /演示版本|本机演示|需要我们确认/);
    assert.match(privacy, /90 天内手动删除/);
    assert.match(privacy, /永久删除小程序上传的照片文件/);
    assert.match(privacy, /查看平台隐私保护指引/);
    await page.screenshot({
      path: 'artifacts/ui/privacy-production-copy.png',
      fullPage: true,
    });
    await visit('story');
    assert.doesNotMatch(await page.locator('.page').innerText(), /排版示例/);
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
