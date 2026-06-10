// 服务端密钥与配置读取。所有 Key 只存在于服务端环境变量，浏览器永不接触。
// 集中在此读取，便于「未配置 → 自动降级到 Mock」与 /api/providers 可用性上报。
// 仅服务端导入（被 Provider 实现引用，绝不进客户端 bundle）。

function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export const arkConfig = {
  apiKey: () => read("ARK_API_KEY"),
  baseUrl: () =>
    read("ARK_BASE_URL") ?? "https://ark.cn-beijing.volces.com/api/v3",
  /** 允许用环境变量切换模型 ID（如升级到 Seedance 2.0）。 */
  seedanceModel: () => read("ARK_SEEDANCE_MODEL"),
  seedreamModel: () => read("ARK_SEEDREAM_MODEL"),
};

export const klingConfig = {
  accessKey: () => read("KLING_ACCESS_KEY"),
  secretKey: () => read("KLING_SECRET_KEY"),
  baseUrl: () => read("KLING_BASE_URL") ?? "https://api.klingai.com",
};
