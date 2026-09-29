export interface MusicConfig {
  enabled: boolean;
  fileId: string;
  title: string;
  volume: number;
  loop: boolean;
}

// 正式版只允许填写自有或已获公开播放授权的音频。未填写时控件不会显示。
export const musicConfig: MusicConfig = {
  enabled: false,
  fileId: '',
  title: '朱超凡&高佳益 · 球球布丁家属院',
  volume: 0.16,
  loop: true,
};
