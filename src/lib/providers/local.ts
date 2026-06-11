// LocalProvider：本地 ffmpeg 视频合成。
// 多个视频片段按连接顺序拼接为一个成片，可混入一条 BGM 音轨。
// 走与远程模型完全相同的异步任务链路（创建→轮询→SSE），产物直接写入
// public/generated/，节点引用永久本地地址。

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  CreateTaskResult,
  GenerationProvider,
  ModelCapability,
  ProviderTaskState,
  UnifiedRequest,
} from "./types";
import { ProviderError } from "./types";
import { CATALOG } from "./catalog";
import {
  buildComposeArgs,
  parseProbeOutput,
  resolutionToSize,
  type ClipInfo,
} from "./ffmpeg";

const execFileAsync = promisify(execFile);

const TMP_DIR = join(process.cwd(), ".data", "tmp");
const OUT_DIR = join(process.cwd(), "public", "generated");

/** 解析 ffmpeg / ffprobe 可执行文件路径：环境变量 > 静态包 > PATH。 */
function resolveBinary(kind: "ffmpeg" | "ffprobe"): string | undefined {
  const envPath = process.env[kind === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH"];
  if (envPath && existsSync(envPath)) return envPath;
  try {
    if (kind === "ffmpeg") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const p = require("ffmpeg-static") as string | null;
      if (p && existsSync(p)) return p;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const p = (require("ffprobe-static") as { path: string }).path;
      if (p && existsSync(p)) return p;
    }
  } catch {
    // 包未安装则回落到 PATH
  }
  return kind; // 交给 PATH 查找；执行失败时报 not_configured
}

interface ComposeJob {
  status: "running" | "succeeded" | "failed";
  progress: number;
  outputUrl?: string;
  error?: string;
}

let jobSeq = 0;
// 进程内任务表。挂 globalThis 以兼容 dev HMR；服务重启后由 hub.resume()
// 将无法找回的 compose 任务判定为失败（getTask 对未知 id 返回 failed）。
const JOBS_KEY = Symbol.for("libtv.composeJobs");
type GlobalWithJobs = typeof globalThis & { [JOBS_KEY]?: Map<string, ComposeJob> };
function jobs(): Map<string, ComposeJob> {
  const g = globalThis as GlobalWithJobs;
  if (!g[JOBS_KEY]) g[JOBS_KEY] = new Map();
  return g[JOBS_KEY];
}

/** 把节点引用的 URL 解析为本地文件：本地公开目录直接映射，远程 URL 下载到临时目录。 */
async function toLocalFile(url: string, hint: string): Promise<string> {
  if (url.startsWith("/")) {
    const path = join(process.cwd(), "public", url.replace(/^\/+/, ""));
    if (!existsSync(path)) {
      throw new ProviderError("invalid_request", `本地文件不存在：${url}`);
    }
    return path;
  }
  if (/^https?:\/\//.test(url)) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new ProviderError(
        "network_error",
        `下载素材失败（HTTP ${res.status}）：${url.slice(0, 80)}`,
        true
      );
    }
    await mkdir(TMP_DIR, { recursive: true });
    const file = join(TMP_DIR, `${hint}-${Date.now()}-${jobSeq}.bin`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    return file;
  }
  throw new ProviderError("invalid_request", `不支持的素材地址：${url.slice(0, 80)}`);
}

export class LocalProvider implements GenerationProvider {
  readonly id = "local" as const;
  readonly label = "本地合成（ffmpeg）";

  private ffmpegPath = resolveBinary("ffmpeg");
  private ffprobePath = resolveBinary("ffprobe");

  isConfigured(): boolean {
    // 静态包内置二进制；只有路径都解析失败才视为未配置
    return !!this.ffmpegPath && !!this.ffprobePath;
  }

  capabilities(): ModelCapability[] {
    return CATALOG.filter((c) => c.providerId === "local");
  }

  async createTask(req: UnifiedRequest): Promise<CreateTaskResult> {
    const id = `compose:${Date.now()}-${++jobSeq}`;
    jobs().set(id, { status: "running", progress: 0 });
    // 后台执行，由统一轮询器经 getTask 拉取进度
    void this.runCompose(id, req).catch((e) => {
      jobs().set(id, {
        status: "failed",
        progress: 0,
        error: e instanceof Error ? e.message : "合成失败",
      });
    });
    return { kind: "async", upstreamTaskId: id };
  }

  async getTask(upstreamTaskId: string): Promise<ProviderTaskState> {
    const job = jobs().get(upstreamTaskId);
    if (!job) {
      return {
        status: "failed",
        error: { code: "task_expired", message: "服务已重启，请重新合成" },
      };
    }
    if (job.status === "succeeded") {
      return {
        status: "succeeded",
        progress: 100,
        outputs: [{ type: "video", url: job.outputUrl! }],
      };
    }
    if (job.status === "failed") {
      return {
        status: "failed",
        error: { code: "upstream_error", message: job.error ?? "合成失败" },
      };
    }
    return { status: "running", progress: job.progress };
  }

  private async runCompose(id: string, req: UnifiedRequest) {
    const update = (patch: Partial<ComposeJob>) => {
      const cur = jobs().get(id);
      if (cur) jobs().set(id, { ...cur, ...patch });
    };

    // 1) 素材就位（本地映射 / 远程下载）
    const videoUrls = req.videos ?? [];
    const videoPaths: string[] = [];
    for (let i = 0; i < videoUrls.length; i++) {
      videoPaths.push(await toLocalFile(videoUrls[i], `clip${i}`));
      update({ progress: Math.round(((i + 1) / videoUrls.length) * 30) });
    }
    const bgmPath = req.audios?.[0]
      ? await toLocalFile(req.audios[0], "bgm")
      : undefined;

    // 2) ffprobe 探测每个片段（音轨有无 / 时长）
    const clips: ClipInfo[] = [];
    for (const path of videoPaths) {
      const { stdout } = await execFileAsync(
        this.ffprobePath!,
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
        { maxBuffer: 8 * 1024 * 1024 }
      ).catch((e) => {
        throw new ProviderError(
          "invalid_request",
          `视频探测失败：${(e as Error).message.slice(0, 160)}`
        );
      });
      clips.push(parseProbeOutput(path, stdout));
    }
    update({ progress: 40 });

    // 3) 合成
    await mkdir(OUT_DIR, { recursive: true });
    const outName = `${id.replace(/[^a-zA-Z0-9-]/g, "-")}.mp4`;
    const outputPath = join(OUT_DIR, outName);
    const { width, height } = resolutionToSize(req.params?.resolution);
    const args = buildComposeArgs(clips, {
      width,
      height,
      fps: 30,
      bgmPath,
      outputPath,
    });
    update({ progress: 50 });
    await execFileAsync(this.ffmpegPath!, args, {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 10 * 60 * 1000,
    }).catch((e) => {
      const msg = (e as { stderr?: string }).stderr?.slice(-300) ?? (e as Error).message;
      throw new ProviderError("upstream_error", `ffmpeg 合成失败：${msg}`);
    });

    update({ status: "succeeded", progress: 100, outputUrl: `/generated/${outName}` });
  }
}
