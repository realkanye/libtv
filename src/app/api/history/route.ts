// GET /api/history — 生成历史：已完成任务的产物清单（图/视频/音频/文本）。
// 前端历史侧栏据此展示，可一键发送到画布。

import { NextResponse } from "next/server";
import { getTaskStore } from "@/lib/tasks/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const items = getTaskStore()
    .all()
    .filter((t) => t.status === "succeeded" && t.outputs.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 100)
    .flatMap((t) =>
      t.outputs.map((o, i) => ({
        id: `${t.id}-${i}`,
        type: o.type,
        url: o.url ?? null,
        text: o.text ? o.text.slice(0, 200) : null,
        shots: o.shots ?? null,
        modelId: t.modelId,
        createdAt: t.updatedAt,
      }))
    );
  return NextResponse.json({ items });
}
