// GET /api/providers — 上报哪些 Provider 已配置可用 + 完整能力目录。
// 前端据此渲染模型下拉（未配置的置灰）与能力驱动的参数面板。

import { NextResponse } from "next/server";
import { providerAvailability } from "@/lib/providers/registry";
import { CATALOG } from "@/lib/providers/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    providers: providerAvailability(),
    catalog: CATALOG,
  });
}
