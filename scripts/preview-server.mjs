// 开发辅助：直接读取原生 WXML/WXSS/TS，不是独立维护的 H5 产品。
// 仅用于布局与 mock 交互回归；不能替代微信真机或原生基础库验收。
import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
const root = resolve('miniprogram');
const pages = (await readdir(resolve(root, 'pages'))).filter((s) =>
  /^[a-z-]+$/.test(s),
);
const components = ['photo-frame', 'page-footer', 'music-control'];
const css = (source) =>
  source
    .replace(/(-?[\d.]+)rpx/g, 'calc($1 * var(--rpx))')
    .replace(/(^|[}\n])\s*page\s*\{/g, '$1body {')
    .replace(/\bview\b/g, 'div')
    .replace(/\bnavigator\b/g, 'a');
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(await readFile('scripts/preview.html'));
      return;
    }
    if (url.pathname === '/runtime.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(await readFile('scripts/preview-runtime.js'));
      return;
    }
    if (url.pathname === '/spec') {
      const name = url.searchParams.get('page') || 'home';
      if (!pages.includes(name)) throw new Error('unknown page');
      const result = {
        template: await readFile(
          resolve(root, `pages/${name}/index.wxml`),
          'utf8',
        ),
        css: css(
          await readFile(resolve(root, `pages/${name}/index.wxss`), 'utf8'),
        ),
        appCss: css(await readFile(resolve(root, 'app.wxss'), 'utf8')),
        components: {},
      };
      for (const comp of components)
        result.components[comp] = {
          template: await readFile(
            resolve(root, `components/${comp}/index.wxml`),
            'utf8',
          ),
          css: css(
            await readFile(
              resolve(root, `components/${comp}/index.wxss`),
              'utf8',
            ),
          ),
        };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
      return;
    }
    if (url.pathname === '/bundle') {
      const kind = url.searchParams.get('kind');
      const name = url.searchParams.get('name');
      if (
        !(
          kind === 'pages' ? pages : kind === 'components' ? components : []
        ).includes(name)
      )
        throw new Error('unknown module');
      const result = await build({
        entryPoints: [resolve(root, `${kind}/${name}/index.ts`)],
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        logLevel: 'silent',
        // 辅助预览固定使用 mock 配置，避免读取开发者本机的云端环境 ID。
        plugins: [
          {
            name: 'preview-mock-config',
            setup(buildContext) {
              buildContext.onResolve({ filter: /config\/local$/ }, () => ({
                path: resolve(root, 'config/local.preview.ts'),
              }));
            },
          },
        ],
      });
      res.setHeader('Content-Type', 'text/javascript');
      res.end(result.outputFiles[0].text);
      return;
    }
    if (/^\/assets\/[a-z-]+\.png$/.test(url.pathname)) {
      res.setHeader('Content-Type', 'image/png');
      res.end(await readFile(resolve(root, '.' + url.pathname)));
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  } catch (error) {
    res.writeHead(500);
    res.end(error.message);
  }
});
const port = Number(process.env.PORT || 4173);
server.listen(port, '127.0.0.1', () =>
  console.log(`本地模板预览 http://127.0.0.1:${port} — 非微信运行时`),
);
