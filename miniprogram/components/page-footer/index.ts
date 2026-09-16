import { uiCopy } from '../../config/ui-copy';
import { appConfig } from '../../services/content';
Component({
  data: {
    copy: uiCopy.pageFooter,
    brand: appConfig.brand,
    cats: appConfig.cats.join(' · '),
  },
  methods: {
    home() {
      wx.reLaunch({ url: '/pages/home/index' });
    },
  },
});
