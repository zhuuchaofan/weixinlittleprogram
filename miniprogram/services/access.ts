import { localConfig } from '../config/local';
import { callCloud } from './cloud';
let pending: Promise<boolean> | undefined;
export function checkAdmin(): Promise<boolean> {
  if (String(localConfig.mode) === 'mock')
    return Promise.resolve(localConfig.mockAdminEnabled);
  if (!pending)
    pending = callCloud<{ isAdmin: boolean }>('getAccess')
      .then((r) => r.isAdmin === true)
      .catch(() => false)
      .finally(() => {
        pending = undefined;
      });
  return pending;
}
