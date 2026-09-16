/** 仅供 scripts/preview-server.mjs 的浏览器回归使用，正式小程序不会导入此文件。 */
export const localConfig: {
  mode: 'mock' | 'cloud';
  cloudEnvId: string;
  mockAdminEnabled: boolean;
} = {
  mode: 'mock',
  // 浏览器预览会为云图片提供临时地址桩；这不是 CloudBase 环境 ID。
  cloudEnvId: 'preview-only',
  mockAdminEnabled: true,
};
