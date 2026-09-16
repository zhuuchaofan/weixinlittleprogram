import { copyFileSync, existsSync } from 'node:fs';
for (const [source, target] of [
  ['project.example.json', 'project.config.json'],
  ['miniprogram/config/local.example.ts', 'miniprogram/config/local.ts'],
]) {
  if (!existsSync(target)) {
    copyFileSync(source, target);
    console.log(`已创建 ${target}`);
  } else console.log(`保留已有 ${target}`);
}
