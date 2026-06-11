// GET  /api/settings — 当前配置（密钥掩码）+ 默认值提示 + Provider 可用性
// POST /api/settings — 保存设置页提交的密钥与模型 ID（空字段不覆盖已有）

import { NextResponse } from "next/server";
import {
  CONFIG_FIELDS,
  getConfig,
  maskSecret,
  updateConfig,
  type AppConfig,
} from "@/lib/server/config";
import { providerAvailability } from "@/lib/providers/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 非密钥字段的默认值提示（作为输入框 placeholder）。 */
const DEFAULT_HINTS: Partial<Record<keyof AppConfig, string>> = {
  arkBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  arkSeedreamModel: "doubao-seedream-4-0",
  arkSeedanceModel: "doubao-seedance-1-0-pro",
  arkLlmModel: "doubao-seed-1-6-250615",
  klingBaseUrl: "https://api.klingai.com",
};

export async function GET() {
  const cfg = getConfig();
  const fields = CONFIG_FIELDS.map(({ key, secret }) => ({
    key,
    secret,
    configured: !!cfg[key],
    // 密钥只回掩码；非密钥回明文便于编辑
    masked: secret ? maskSecret(cfg[key]) : undefined,
    value: secret ? undefined : (cfg[key] ?? ""),
    hint: DEFAULT_HINTS[key] ?? "",
  }));
  return NextResponse.json({
    fields,
    providers: providerAvailability(),
  });
}

export async function POST(req: Request) {
  let body: Partial<AppConfig>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  // 只接受已知字段
  const patch: Partial<AppConfig> = {};
  for (const { key } of CONFIG_FIELDS) {
    if (typeof body[key] === "string") patch[key] = body[key];
  }
  await updateConfig(patch);
  return NextResponse.json({ ok: true, providers: providerAvailability() });
}
