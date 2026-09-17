import { uiCopy } from '../../config/ui-copy';
import { appConfig } from '../../services/content';
import { checkAdmin } from '../../services/access';
Component({
  lifetimes: {
    attached() {
      void this.refreshAccess();
    },
  },
  pageLifetimes: {
    show() {
      void this.refreshAccess();
    },
  },
  data: {
    isAdmin: false,
    copy: uiCopy.pageFooter,
    brand: appConfig.brand,
    cats: appConfig.cats.join(' · '),
  },
  methods: {
    async refreshAccess() {
      this.setData({ isAdmin: false });
      this.setData({ isAdmin: await checkAdmin() });
    },
    home() {
      wx.reLaunch({ url: '/pages/home/index' });
    },
  },
});
