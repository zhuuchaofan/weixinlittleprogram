const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  module._compile(result.outputText, filename);
};
const {
  createMusicService,
  isMusicConfigured,
} = require('../miniprogram/services/music.ts');

const config = {
  enabled: true,
  fileId: 'cloud://env/wedding/music/background.mp3',
  title: '朱超凡&高佳益 · 两猫一屋',
  volume: 0.16,
  loop: true,
};

function createPlatform() {
  const events = {};
  const calls = { create: 0, resolve: 0, option: 0, play: 0, pause: 0 };
  const storage = new Map();
  const audio = {
    src: '',
    autoplay: false,
    loop: false,
    volume: 1,
    obeyMuteSwitch: false,
    play() {
      calls.play += 1;
      events.play?.();
    },
    pause() {
      calls.pause += 1;
      events.pause?.();
    },
    destroy() {},
    onPlay(callback) {
      events.play = callback;
    },
    onPause(callback) {
      events.pause = callback;
    },
    onStop(callback) {
      events.stop = callback;
    },
    onEnded(callback) {
      events.ended = callback;
    },
    onError(callback) {
      events.error = callback;
    },
  };
  return {
    calls,
    storage,
    audio,
    events,
    platform: {
      createAudio() {
        calls.create += 1;
        return audio;
      },
      async resolveCloudFile() {
        calls.resolve += 1;
        return 'https://example.test/background.mp3';
      },
      getStorage(key) {
        return storage.get(key);
      },
      setStorage(key, value) {
        storage.set(key, value);
      },
      setAudioOption() {
        calls.option += 1;
      },
    },
  };
}

test('未配置背景音乐时不创建播放器', async () => {
  const fixture = createPlatform();
  const service = createMusicService(
    { ...config, enabled: false, fileId: '' },
    fixture.platform,
  );
  assert.equal(
    isMusicConfigured({ ...config, enabled: false, fileId: '' }),
    false,
  );
  await service.autoStart();
  assert.deepEqual(service.getSnapshot(), { enabled: false, status: 'idle' });
  assert.equal(fixture.calls.create, 0);
});

test('首次自动播放使用低音量循环并只解析一次云端链接', async () => {
  const fixture = createPlatform();
  const service = createMusicService(config, fixture.platform);
  await service.autoStart();
  await service.autoStart();
  assert.equal(service.getSnapshot().status, 'playing');
  assert.equal(fixture.calls.create, 1);
  assert.equal(fixture.calls.resolve, 1);
  assert.equal(fixture.calls.option, 1);
  assert.equal(fixture.audio.loop, true);
  assert.equal(fixture.audio.volume, 0.16);
  assert.equal(fixture.audio.obeyMuteSwitch, true);
});

test('手动暂停后前后台不自动恢复，重新点击才播放', async () => {
  const fixture = createPlatform();
  const service = createMusicService(config, fixture.platform);
  await service.autoStart();
  await service.toggle();
  assert.equal(service.getSnapshot().status, 'paused');
  assert.equal(fixture.storage.get('two-cats:music-paused'), true);
  service.pauseForAppHide();
  await service.resumeAfterAppShow();
  assert.equal(fixture.calls.play, 1);
  await service.toggle();
  assert.equal(fixture.storage.get('two-cats:music-paused'), false);
  assert.equal(fixture.calls.play, 2);
});

test('切后台暂停并在回到前台恢复；失败后点击可重试', async () => {
  const fixture = createPlatform();
  const service = createMusicService(config, fixture.platform);
  await service.autoStart();
  service.pauseForAppHide();
  assert.equal(fixture.calls.pause, 1);
  await service.resumeAfterAppShow();
  assert.equal(fixture.calls.play, 2);
  fixture.events.error();
  assert.equal(service.getSnapshot().status, 'error');
  await service.toggle();
  assert.equal(service.getSnapshot().status, 'playing');
  assert.equal(fixture.calls.resolve, 2);
});
