// 把 docs/VIP-AGREEMENT.md 同步成会员页里能打开的协议页数据。改协议只改源文件，然后运行 npm run agreement。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export const SOURCE = 'docs/VIP-AGREEMENT.md';
export const TARGET = 'miniprogram/config/agreement.ts';

/** 一行文字拆成普通段和 **加粗** 段。 */
function spans(text) {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((part) =>
      part.startsWith('**')
        ? { text: part.slice(2, -2), bold: true }
        : { text: part, bold: false },
    );
}

/** 只支持协议里用到的写法：# 标题、## 小节标题、段落、「1. 」编号条款、「- 」子项。 */
export function parse(markdown) {
  const doc = { title: '', dates: [], intro: [], sections: [] };
  let section = null;
  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (line.startsWith('# ')) doc.title = line.slice(2);
    else if (line.startsWith('## ')) {
      section = { title: line.slice(3), items: [] };
      doc.sections.push(section);
    } else if (!section) {
      (/^(更新|生效)日期/.test(line) ? doc.dates : doc.intro).push(line);
    } else if (/^\s+- /.test(line)) {
      section.items.push({
        spans: spans(`· ${line.trim().slice(2)}`),
        sub: true,
      });
    } else {
      section.items.push({ spans: spans(line), sub: false });
    }
  }
  doc.intro = doc.intro.map(spans);
  return doc;
}

export function render() {
  const doc = parse(readFileSync(`${root}${SOURCE}`, 'utf8'));
  return `// 由 scripts/agreement.mjs 从 ${SOURCE} 生成，不要手改。\nexport const AGREEMENT = ${JSON.stringify(doc, null, 2)};\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(`${root}${TARGET}`, render());
  console.log(`已同步 ${TARGET}`);
}
