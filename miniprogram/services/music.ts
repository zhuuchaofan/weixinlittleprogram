import { musicConfig, type MusicConfig } from '../config/music';
import { invalidateCloudFileUrl, resolveCloudFileUrl } from './cloud-file-url';

export type MusicStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
export type MusicSnapshot = {
  enabled: boolean;
  status: MusicStatus;
};

type AudioContextLike = {
  src: string;
  autoplay: boolean;
  loop: boolean;
  volume: number;
  obeyMuteSwitch?: boolean;
  play(): void;
  pause(): void;
  destroy(): void;
  onPlay(callback: () => void): void;
  onPause(callback: () => void): void;
  onStop(callback: () => void): void;
  onEnded(callback: () => void): void;
  onError(callback: () => void): void;
};
type MusicPlatform = {
  createAudio(): AudioContextLike;
  resolveCloudFile(fileId: string): Promise<string>;
  getStorage(key: string): unknown;
  setStorage(key: string, value: unknown): void;
  setAudioOption(): void;
};

const pausedStorageKey = 'two-cats:music-paused';

export function isMusicConfigured(config: MusicConfig = musicConfig): boolean {
  return config.enabled && !!config.fileId.trim();
}

function defaultPlatform(): MusicPlatform {
  return {
    createAudio: () =>
      wx.createInnerAudioContext() as unknown as AudioContextLike,
    resolveCloudFile: (fileId) => resolveCloudFileUrl(fileId, 'original'),
    getStorage: (key) => wx.getStorageSync(key),
    setStorage: (key, value) => wx.setStorageSync(key, value),
    setAudioOption() {
      wx.setInnerAudioOption({
        mixWithOther: true,
        obeyMuteSwitch: true,
        fail: () => undefined,
      });
    },
  };
}

export function createMusicService(
  config: MusicConfig = musicConfig,
  platform: MusicPlatform = defaultPlatform(),
) {
  let audio: AudioContextLike | undefined;
  let source = '';
  let autoStarted = false;
  let resumeAfterAppShow = false;
  let snapshot: MusicSnapshot = {
    enabled: isMusicConfigured(config),
    status: 'idle',
  };
  const listeners = new Set<(next: MusicSnapshot) => void>();

  const publish = (status: MusicStatus) => {
    snapshot = { enabled: isMusicConfigured(config), status };
    listeners.forEach((listener) => listener(snapshot));
  };
  const isPausedByUser = () => {
    try {
      return platform.getStorage(pausedStorageKey) === true;
    } catch {
      return false;
    }
  };
  const setPausedByUser = (value: boolean) => {
    try {
      platform.setStorage(pausedStorageKey, value);
    } catch {
      // 本机偏好不可写时，播放功能仍可继续使用。
    }
  };
  const ensureAudio = () => {
    if (audio) return audio;
    platform.setAudioOption();
    audio = platform.createAudio();
    audio.autoplay = false;
    audio.loop = config.loop;
    audio.volume = config.volume;
    audio.obeyMuteSwitch = true;
    audio.onPlay(() => publish('playing'));
    audio.onPause(() => publish('paused'));
    audio.onStop(() => publish('paused'));
    audio.onEnded(() => publish('paused'));
    audio.onError(() => {
      source = '';
      invalidateCloudFileUrl(config.fileId);
      publish('error');
    });
    return audio;
  };
  const play = async () => {
    if (!isMusicConfigured(config)) return;
    const context = ensureAudio();
    publish('loading');
    try {
      if (!source) {
        source = await platform.resolveCloudFile(config.fileId);
        context.src = source;
      }
      context.play();
    } catch {
      source = '';
      invalidateCloudFileUrl(config.fileId);
      publish('error');
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: (next: MusicSnapshot) => void) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    async autoStart() {
      if (autoStarted || !isMusicConfigured(config) || isPausedByUser()) return;
      autoStarted = true;
      await play();
    },
    async toggle() {
      if (!isMusicConfigured(config)) return;
      if (snapshot.status === 'playing' || snapshot.status === 'loading') {
        resumeAfterAppShow = false;
        setPausedByUser(true);
        audio?.pause();
        publish('paused');
        return;
      }
      setPausedByUser(false);
      if (snapshot.status === 'error') {
        source = '';
        invalidateCloudFileUrl(config.fileId);
      }
      await play();
    },
    pauseForAppHide() {
      resumeAfterAppShow = snapshot.status === 'playing';
      if (resumeAfterAppShow) audio?.pause();
    },
    async resumeAfterAppShow() {
      if (!resumeAfterAppShow || isPausedByUser()) return;
      resumeAfterAppShow = false;
      await play();
    },
    destroy() {
      audio?.destroy();
      audio = undefined;
      source = '';
      resumeAfterAppShow = false;
      publish('idle');
    },
  };
}

export const musicService = createMusicService();
