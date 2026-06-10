// GET  /api/tasks/[id] — 查询任务状态（前端刷新后恢复用）。
// POST /api/tasks/[id] — 一键重试（沿用原始请求重跑）。

import { NextResponse } from "next/server";
import { getTaskHub } from "@/lib/tasks/hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const view = getTaskHub().getView(id);
  if (!view) {
    return NextResponse.json({ error: "任务不存在或已过期" }, { status: 404 });
  }
  return NextResponse.json(view);
}

export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const view = getTaskHub().retry(id);
  if (!view) {
    return NextResponse.json({ error: "任务不存在或已过期" }, { status: 404 });
  }
  return NextResponse.json({ taskId: view.id });
}
