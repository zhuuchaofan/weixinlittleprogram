export const localConfig: {
  mode: 'mock' | 'cloud';
  cloudEnvId: string;
  mockAdminEnabled: boolean;
} = {
  mode: 'mock',
  cloudEnvId: '',
  // 只允许查看当前设备的演示数据；云端永远不使用此开关鉴权。
  mockAdminEnabled: true,
};
