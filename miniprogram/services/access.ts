import { localConfig } from '../config/local';
import { callCloud } from './cloud';

const ADMIN_CACHE_MS = 5 * 60 * 1000;

export interface AccessCheckerOptions {
  request?: () => Promise<boolean>;
  now?: () => number;
}

/** 菜单展示只缓存短时间的管理员判断；实际管理操作仍由云函数重新鉴权。 */
export function createAccessChecker(options: AccessCheckerOptions = {}) {
  const request =
    options.request ||
    (() =>
      callCloud<{ isAdmin: boolean }>('getAccess').then(
        (result) => result.isAdmin === true,
      ));
  const now = options.now || (() => Date.now());
  let pending: Promise<boolean> | undefined;
  let cached: { value: boolean; expiresAt: number } | undefined;

  return {
    async checkAdmin(): Promise<boolean> {
      if (String(localConfig.mode) === 'mock')
        return localConfig.mockAdminEnabled;
      if (cached && cached.expiresAt > now()) return cached.value;
      if (!pending)
        pending = request()
          .catch(() => false)
          .then((value) => {
            cached = { value, expiresAt: now() + ADMIN_CACHE_MS };
            return value;
          })
          .finally(() => {
            pending = undefined;
          });
      return pending;
    },
    clear() {
      cached = undefined;
    },
  };
}

const accessChecker = createAccessChecker();

export function checkAdmin(): Promise<boolean> {
  return accessChecker.checkAdmin();
}
