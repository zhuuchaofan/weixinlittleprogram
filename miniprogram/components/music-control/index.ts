import { getReduceMotion } from '../../services/motion-preference';
import { musicService, type MusicSnapshot } from '../../services/music';

const cleanup = new WeakMap<object, () => void>();
function componentData(snapshot: MusicSnapshot) {
  return {
    visible: snapshot.enabled,
    status: snapshot.status,
    playing: snapshot.status === 'playing',
    loading: snapshot.status === 'loading',
    reduceMotion: getReduceMotion(),
    label:
      snapshot.status === 'playing'
        ? '暂停背景音乐'
        : snapshot.status === 'error'
          ? '重新加载背景音乐'
          : '播放背景音乐',
  };
}
Component({
  properties: {
    variant: { type: String, value: 'floating' },
  },
  data: componentData(musicService.getSnapshot()),
  lifetimes: {
    attached() {
      cleanup.set(
        this,
        musicService.subscribe((snapshot) =>
          this.setData(componentData(snapshot)),
        ),
      );
    },
    detached() {
      cleanup.get(this)?.();
      cleanup.delete(this);
    },
  },
  pageLifetimes: {
    show() {
      this.setData({
        reduceMotion: getReduceMotion(),
      });
    },
  },
  methods: {
    toggle() {
      void musicService.toggle();
    },
  },
});
