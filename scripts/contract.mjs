// 把 shared/contract.json 同步到云函数与小程序。改分类、标签、字段长度只改源文件，然后运行 npm run contract。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export const SOURCE = 'shared/contract.json';
export const TARGETS = {
  cloud: 'cloudfunctions/api/contract.json',
  miniprogram: 'miniprogram/config/contract.ts',
};

/** 各副本应有的内容。小程序不能直接 require JSON，生成为 TS 常量。 */
export function render() {
  const json = readFileSync(`${root}${SOURCE}`, 'utf8');
  const data = JSON.parse(json);
  return {
    [TARGETS.cloud]: json,
    [TARGETS.miniprogram]: `// 由 scripts/contract.mjs 从 ${SOURCE} 生成，不要手改。\nexport const CONTRACT = ${JSON.stringify(data, null, 2)} as const;\n`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [path, content] of Object.entries(render())) {
    writeFileSync(`${root}${path}`, content);
    console.log(`已同步 ${path}`);
  }
}
