import { spawnSync } from 'node:child_process';
import { readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const toolsPath =
  process.env.WECHAT_COMPILER_DIR ||
  'C:/Program Files (x86)/Tencent/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec';
function walk(dir, ext) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((f) =>
    f.isDirectory()
      ? walk(`${dir}/${f.name}`, ext)
      : f.name.endsWith(ext)
        ? [`${dir}/${f.name}`]
        : [],
  );
}
mkdirSync('artifacts', { recursive: true });
for (const [name, ext] of [
  ['wcc', '.wxml'],
  ['wcsc', '.wxss'],
]) {
  const files = walk('miniprogram', ext).map((p) =>
    p.replace('miniprogram/', './'),
  );
  const result = spawnSync(
    `${toolsPath}/${name}.exe`,
    [...files, '-o', resolve(`artifacts/${name}-compiled.js`)],
    { cwd: 'miniprogram', encoding: 'utf8' },
  );
  if (result.error || result.status !== 0) {
    console.error(result.error || result.stderr || result.stdout);
    process.exitCode = 1;
  } else {
    console.log(`${name}: ${files.length} 个文件编译通过`);
    if (result.stderr) console.log(result.stderr);
  }
}
