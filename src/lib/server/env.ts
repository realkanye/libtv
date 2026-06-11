// 各 Provider 的配置读取入口。统一走运行时配置存储（设置页文件 > 环境变量 > 默认值），
// 因此在设置页填入密钥即时生效，无需重启或改文件。
// 仅服务端导入（绝不进客户端 bundle）。

import { getConfig } from "./config";

export const arkConfig = {
  apiKey: () => getConfig().arkApiKey,
  baseUrl: () =>
    getConfig().arkBaseUrl ?? "https://ark.cn-beijing.volces.com/api/v3",
  /** 允许用设置页/环境变量切换模型 ID（如升级到 Seedance 2.0）。 */
  seedanceModel: () => getConfig().arkSeedanceModel,
  seedreamModel: () => getConfig().arkSeedreamModel,
  llmModel: () => getConfig().arkLlmModel,
};

export const klingConfig = {
  accessKey: () => getConfig().klingAccessKey,
  secretKey: () => getConfig().klingSecretKey,
  baseUrl: () => getConfig().klingBaseUrl ?? "https://api.klingai.com",
};
