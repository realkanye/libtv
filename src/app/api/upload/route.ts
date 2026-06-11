// POST /api/upload — 接收画布拖入/右键上传的文件，落盘 public/uploads/。
// 返回 { url, kind }，前端据此创建对应类型的内容节点。

import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NodeKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOAD_DIR = join(process.cwd(), "public", "uploads");

/** mime → 节点类型 + 扩展名 + 大小上限（MB）。 */
const ACCEPTED: Record<string, { kind: NodeKind; ext: string; maxMB: number }> = {
  "image/png": { kind: "image", ext: "png", maxMB: 15 },
  "image/jpeg": { kind: "image", ext: "jpg", maxMB: 15 },
  "image/webp": { kind: "image", ext: "webp", maxMB: 15 },
  "image/gif": { kind: "image", ext: "gif", maxMB: 15 },
  "video/mp4": { kind: "video", ext: "mp4", maxMB: 200 },
  "video/webm": { kind: "video", ext: "webm", maxMB: 200 },
  "video/quicktime": { kind: "video", ext: "mov", maxMB: 200 },
  "audio/mpeg": { kind: "audio", ext: "mp3", maxMB: 30 },
  "audio/wav": { kind: "audio", ext: "wav", maxMB: 30 },
  "audio/x-wav": { kind: "audio", ext: "wav", maxMB: 30 },
  "audio/mp4": { kind: "audio", ext: "m4a", maxMB: 30 },
  "audio/aac": { kind: "audio", ext: "aac", maxMB: 30 },
  "audio/ogg": { kind: "audio", ext: "ogg", maxMB: 30 },
};

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "请求不是合法的表单数据" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少文件" }, { status: 400 });
  }

  const spec = ACCEPTED[file.type];
  if (!spec) {
    return NextResponse.json(
      { error: `不支持的文件类型（${file.type || "未知"}），支持图片/视频/音频` },
      { status: 400 }
    );
  }
  if (file.size > spec.maxMB * 1024 * 1024) {
    return NextResponse.json(
      { error: `文件过大，${spec.kind === "image" ? "图片" : spec.kind === "video" ? "视频" : "音频"}最大 ${spec.maxMB}MB` },
      { status: 400 }
    );
  }

  await mkdir(UPLOAD_DIR, { recursive: true });
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${spec.ext}`;
  await writeFile(join(UPLOAD_DIR, name), Buffer.from(await file.arrayBuffer()));

  return NextResponse.json({ url: `/uploads/${name}`, kind: spec.kind });
}
