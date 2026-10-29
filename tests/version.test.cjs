const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('package.json 的版本号和 CHANGELOG 最新一节一致', () => {
  const { version } = JSON.parse(read('package.json'));
  const latest = /^## (\d+\.\d+\.\d+)/m.exec(read('CHANGELOG.md'));
  assert.ok(latest, 'CHANGELOG.md 里找不到版本标题');
  assert.equal(version, latest[1]);
});

test('package-lock.json 的版本号和 package.json 一致', () => {
  const { version } = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.version, version);
  assert.equal(lock.packages[''].version, version);
});
