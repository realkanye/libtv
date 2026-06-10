// 产物转存：上游（可灵/方舟）的产物 URL 有时效，任务完成后立即下载到本地
// public/generated/，节点引用永久本地地址，避免「昨天生成的今天打不开」。
// 转存失败时保留原始 URL（不因转存失败而丢结果）。

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GenerationOutput } from "@/lib/providers/types";

const PUBLIC_DIR = join(process.cwd(), "public", "generated");

const EXT_BY_TYPE: Record<string, string> = {
  image: "png",
  video: "mp4",
  audio: "mp3",
};

function extFromContentType(ct: string | null, fallback: string): string {
  if (!ct) return fallback;
  if (ct.includes("mp4")) return "mp4";
  if (ct.includes("webm")) return "webm";
  if (ct.includes("png")) return "png";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("mpeg") || ct.includes("mp3")) return "mp3";
  if (ct.includes("wav")) return "wav";
  return fallback;
}

/** 单个产物转存；失败则原样返回。 */
async function localizeOne(
  taskId: string,
  index: number,
  output: GenerationOutput
): Promise<GenerationOutput> {
  const url = output.url;
  // 文本/分镜无 URL；已是本地地址的不再处理。
  if (!url || url.startsWith("/")) return output;

  try {
    let buffer: Buffer;
    let ext = EXT_BY_TYPE[output.type] ?? "bin";

    if (url.startsWith("data:")) {
      const m = url.match(/^data:([^;]+);base64,(.*)$/);
      if (!m) return output;
      buffer = Buffer.from(m[2], "base64");
      ext = extFromContentType(m[1], ext);
    } else {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buffer = Buffer.from(await res.arrayBuffer());
      ext = extFromContentType(res.headers.get("content-type"), ext);
    }

    await mkdir(PUBLIC_DIR, { recursive: true });
    const filename = `${taskId}-${index}.${ext}`;
    await writeFile(join(PUBLIC_DIR, filename), buffer);
    return { ...output, url: `/generated/${filename}` };
  } catch (e) {
    console.warn(`[assets] 转存失败，保留原始地址: ${url}`, (e as Error).message);
    return output;
  }
}

/** 批量转存任务产物。 */
export async function localizeOutputs(
  taskId: string,
  outputs: GenerationOutput[]
): Promise<GenerationOutput[]> {
  return Promise.all(outputs.map((o, i) => localizeOne(taskId, i, o)));
}
