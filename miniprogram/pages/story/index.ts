import { uiCopy } from '../../config/ui-copy';
import { appConfig, storyItems } from '../../services/content';
import { previewPhotos } from '../../utils/preview';
Page({
  data: { copy: uiCopy.story, appConfig, storyItems },
  preview(event: WechatMiniprogram.CustomEvent) {
    const { story, photo } = event.currentTarget.dataset;
    const item = storyItems[Number(story)];
    if (item) previewPhotos(item.photos, Number(photo));
  },
});
