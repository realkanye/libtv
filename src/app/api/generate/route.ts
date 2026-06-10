// POST /api/generate — 校验请求并创建生成任务，立即返回 taskId。
// 真实产物通过 SSE（/api/tasks/[id]/stream）推送。

import { NextResponse } from "next/server";
import { validateAndNormalize } from "@/lib/providers/validate";
import { getProvider } from "@/lib/providers/registry";
import { getTaskHub } from "@/lib/tasks/hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const nodeId =
    body && typeof body === "object" && "nodeId" in body
      ? String((body as { nodeId: unknown }).nodeId ?? "")
      : "";
  if (!nodeId) {
    return NextResponse.json({ error: "缺少 nodeId" }, { status: 400 });
  }

  // 能力声明驱动的校验：不合法请求在此被拦下，不会发往上游。
  const result = validateAndNormalize(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  // 未配置密钥的 Provider 直接给出明确提示（前端本应置灰，这里兜底）。
  const provider = getProvider(result.value.providerId);
  if (!provider.isConfigured()) {
    return NextResponse.json(
      { error: `「${provider.label}」未配置密钥，请改用其它模型` },
      { status: 400 }
    );
  }

  const task = getTaskHub().create(nodeId, result.value);
  return NextResponse.json({ taskId: task.id });
}
