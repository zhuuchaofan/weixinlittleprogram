import { callApi } from './cloud';

/** 全部数据的 JSON 文本（不含 openid），可直接 JSON.parse 读回。 */
export async function exportAllText(): Promise<string> {
  return JSON.stringify(await callApi<unknown>('data.export'), null, 2);
}
