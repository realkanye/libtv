// Provider 注册表。新接一家平台：实现 GenerationProvider，在此登记即可。
// 仅服务端导入（聚合了引用密钥/网络的 Provider 实现）。

import type { GenerationProvider, ProviderId } from "./types";
import { MockProvider } from "./mock";
import { ArkProvider } from "./ark";
import { KlingProvider } from "./kling";

const providers: Record<ProviderId, GenerationProvider> = {
  mock: new MockProvider(),
  ark: new ArkProvider(),
  kling: new KlingProvider(),
};

export function getProvider(id: ProviderId): GenerationProvider {
  return providers[id];
}

export function listProviders(): GenerationProvider[] {
  return Object.values(providers);
}

/** 各 Provider 的可用性（前端据此置灰未配置的模型）。 */
export function providerAvailability(): {
  id: ProviderId;
  label: string;
  configured: boolean;
}[] {
  return listProviders().map((p) => ({
    id: p.id,
    label: p.label,
    configured: p.isConfigured(),
  }));
}
