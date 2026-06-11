// LocalProvider 端到端集成测试：真实调用 ffmpeg 生成两段测试片段并拼接。
// 仅在 ffmpeg 二进制可用时运行（静态包随依赖安装，正常都可用）。

import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { LocalProvider } from "./local";
import type { UnifiedRequest } from "./types";

const execFileAsync = promisify(execFile);

function ffmpegPath(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = require("ffmpeg-static") as string | null;
    return p && existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

const ffmpeg = ffmpegPath();

describe.runIf(!!ffmpeg)("LocalProvider 真实合成（ffmpeg）", () => {
  it(
    "两段测试片段拼接为成片",
    async () => {
      // 准备：生成两段 0.5s 的纯色测试片段（一段带音轨、一段不带）
      const dir = join(process.cwd(), "public", "uploads");
      await mkdir(dir, { recursive: true });
      const a = join(dir, "test-clip-a.mp4");
      const b = join(dir, "test-clip-b.mp4");
      await execFileAsync(ffmpeg!, [
        "-y", "-f", "lavfi", "-i", "color=c=red:s=320x180:d=0.5",
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-shortest",
        "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", a,
      ]);
      await execFileAsync(ffmpeg!, [
        "-y", "-f", "lavfi", "-i", "color=c=blue:s=640x360:d=0.5",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", b,
      ]);

      const provider = new LocalProvider();
      expect(provider.isConfigured()).toBe(true);

      const req: UnifiedRequest = {
        providerId: "local",
        modelId: "ffmpeg-compose",
        mode: "compose-video",
        prompt: "",
        videos: ["/uploads/test-clip-a.mp4", "/uploads/test-clip-b.mp4"],
        params: { resolution: "720p" },
      };
      const created = await provider.createTask(req);
      expect(created.kind).toBe("async");
      if (created.kind !== "async") return;

      // 轮询直到完成
      let state = await provider.getTask(created.upstreamTaskId);
      const deadline = Date.now() + 60_000;
      while (state.status === "running" && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 300));
        state = await provider.getTask(created.upstreamTaskId);
      }
      expect(state.status).toBe("succeeded");
      const url = state.outputs?.[0]?.url;
      expect(url).toMatch(/^\/generated\/.+\.mp4$/);
      expect(
        existsSync(join(process.cwd(), "public", url!.replace(/^\//, "")))
      ).toBe(true);
    },
    90_000
  );
});
