// 火山方舟（即梦 / 字节）Provider。
// 鉴权：API Key Bearer。Seedream 图片同步出图；Seedance 视频异步任务（创建→轮询）。
//
// 接口形态依据火山方舟公开文档整理；模型 ID 可通过环境变量覆盖（便于升级到
// Seedance 2.0 等）。所有请求构造/响应解析都有契约测试覆盖（ark.test.ts）。

import { arkConfig } from "@/lib/server/env";
import type {
  CreateTaskResult,
  GenerationOutput,
  GenerationProvider,
  ModelCapability,
  ProviderTaskState,
  UnifiedRequest,
} from "./types";
import { ProviderError } from "./types";
import { CATALOG } from "./catalog";

import type { ShotRow } from "@/lib/types";

interface ArkImageResponse {
  data?: { url?: string }[];
  error?: { code?: string; message?: string };
}

interface ArkChatResponse {
  choices?: { message?: { content?: string } }[];
  error?: { code?: string; message?: string };
}

interface ArkTaskCreateResponse {
  id?: string;
  error?: { code?: string; message?: string };
}

interface ArkTaskQueryResponse {
  id?: string;
  status?: string; // queued | running | succeeded | failed | cancelled
  content?: { video_url?: string };
  error?: { code?: string; message?: string };
}

/** 把 HTTP 状态码 + 上游错误映射成统一错误码。 */
function mapHttpError(status: number, body: string): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError("auth_failed", "火山方舟鉴权失败，请检查 ARK_API_KEY");
  }
  if (status === 429) {
    return new ProviderError("rate_limited", "火山方舟触发限流，请稍后重试", true);
  }
  const lower = body.toLowerCase();
  if (lower.includes("quota") || lower.includes("balance") || lower.includes("欠费")) {
    return new ProviderError("quota_exceeded", "火山方舟余额/配额不足");
  }
  if (
    lower.includes("sensitive") ||
    lower.includes("audit") ||
    lower.includes("审核") ||
    lower.includes("risk")
  ) {
    return new ProviderError("content_rejected", "内容未通过审核，请调整提示词");
  }
  return new ProviderError(
    "upstream_error",
    `火山方舟返回错误（${status}）：${body.slice(0, 200)}`
  );
}

/** 由画幅比 + 分辨率档位推导出 Seedream 的像素尺寸（长边对齐档位，取 8 的倍数）。 */
export function arkImageSize(aspectRatio?: string, resolution?: string): string {
  const longBase =
    resolution === "4K" ? 4096 : resolution === "1K" ? 1024 : 2048;
  const [w, h] = (aspectRatio ?? "1:1").split(":").map(Number);
  const ratioW = w || 1;
  const ratioH = h || 1;
  let width: number;
  let height: number;
  if (ratioW >= ratioH) {
    width = longBase;
    height = Math.round((longBase * ratioH) / ratioW);
  } else {
    height = longBase;
    width = Math.round((longBase * ratioW) / ratioH);
  }
  const round8 = (n: number) => Math.max(8, Math.round(n / 8) * 8);
  return `${round8(width)}x${round8(height)}`;
}

/** 把生成参数拼成 Seedance 文本指令后缀。 */
export function arkVideoPromptFlags(req: UnifiedRequest): string {
  const p = req.params ?? {};
  const flags: string[] = [];
  if (p.aspectRatio) flags.push(`--ratio ${p.aspectRatio}`);
  if (p.duration) flags.push(`--duration ${p.duration}`);
  if (p.resolution) flags.push(`--resolution ${p.resolution}`);
  return flags.length ? ` ${flags.join(" ")}` : "";
}

export class ArkProvider implements GenerationProvider {
  readonly id = "ark" as const;
  readonly label = "火山方舟（即梦）";

  isConfigured(): boolean {
    return !!arkConfig.apiKey();
  }

  capabilities(): ModelCapability[] {
    return CATALOG.filter((c) => c.providerId === "ark");
  }

  private headers(): Record<string, string> {
    const key = arkConfig.apiKey();
    if (!key) {
      throw new ProviderError("not_configured", "未配置 ARK_API_KEY");
    }
    return {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
  }

  /** 实际调用上游的模型 ID（允许环境变量覆盖 catalog 默认值）。 */
  private resolveModelId(req: UnifiedRequest): string {
    if (req.modelId.includes("seedream")) {
      return arkConfig.seedreamModel() ?? req.modelId;
    }
    if (req.modelId.includes("seedance")) {
      return arkConfig.seedanceModel() ?? req.modelId;
    }
    if (req.mode === "text-to-text" || req.mode === "text-to-script") {
      return arkConfig.llmModel() ?? req.modelId;
    }
    return req.modelId;
  }

  async createTask(req: UnifiedRequest): Promise<CreateTaskResult> {
    if (req.mode === "text-to-text" || req.mode === "text-to-script") {
      return this.createChat(req);
    }
    if (req.modelId.includes("seedream")) {
      return this.createImage(req);
    }
    return this.createVideo(req);
  }

  /** LLM：文本 / 结构化分镜脚本（chat completions，同步）。 */
  private async createChat(req: UnifiedRequest): Promise<CreateTaskResult> {
    const model = this.resolveModelId(req);
    const isScript = req.mode === "text-to-script";
    const refBlock = req.refTexts?.length
      ? `\n\n参考资料：\n${req.refTexts.join("\n---\n")}`
      : "";
    const res = await this.post<ArkChatResponse>("/chat/completions", {
      model,
      messages: [
        { role: "system", content: isScript ? SCRIPT_SYSTEM_PROMPT : TEXT_SYSTEM_PROMPT },
        { role: "user", content: req.prompt + refBlock },
      ],
      temperature: 0.7,
    });
    const content = res.choices?.[0]?.message?.content;
    if (!content) {
      throw new ProviderError("upstream_error", "方舟 LLM 未返回内容");
    }
    if (!isScript) {
      return { kind: "sync", outputs: [{ type: "text", text: content }] };
    }
    const shots = parseScriptShots(content);
    if (!shots.length) {
      throw new ProviderError(
        "upstream_error",
        "分镜脚本解析失败，请重试或调整提示词"
      );
    }
    return {
      kind: "sync",
      outputs: [{ type: "script", text: req.prompt, shots }],
    };
  }

  /** Seedream：同步出图，count>1 时并发多次请求。 */
  private async createImage(req: UnifiedRequest): Promise<CreateTaskResult> {
    const model = this.resolveModelId(req);
    const size = arkImageSize(req.params?.aspectRatio, req.params?.resolution);
    const count = req.params?.count ?? 1;
    const refImages = req.images ?? [];

    const once = async (): Promise<GenerationOutput> => {
      const body: Record<string, unknown> = {
        model,
        prompt: req.prompt,
        size,
        response_format: "url",
        watermark: false,
      };
      if (refImages.length === 1) body.image = refImages[0];
      else if (refImages.length > 1) body.image = refImages;

      const res = await this.post<ArkImageResponse>("/images/generations", body);
      const url = res.data?.[0]?.url;
      if (!url) {
        throw new ProviderError("upstream_error", "Seedream 未返回图片地址");
      }
      return { type: "image", url };
    };

    const outputs = await Promise.all(
      Array.from({ length: count }, () => once())
    );
    return { kind: "sync", outputs };
  }

  /** Seedance：创建异步任务，返回 task id。 */
  private async createVideo(req: UnifiedRequest): Promise<CreateTaskResult> {
    const model = this.resolveModelId(req);
    const content: Record<string, unknown>[] = [
      { type: "text", text: req.prompt + arkVideoPromptFlags(req) },
    ];
    // 首帧图（image-to-video）
    if (req.images?.[0]) {
      content.push({ type: "image_url", image_url: { url: req.images[0] } });
    }
    const res = await this.post<ArkTaskCreateResponse>(
      "/contents/generations/tasks",
      { model, content }
    );
    if (!res.id) {
      throw new ProviderError("upstream_error", "Seedance 未返回任务 ID");
    }
    return { kind: "async", upstreamTaskId: res.id };
  }

  async getTask(upstreamTaskId: string): Promise<ProviderTaskState> {
    const res = await this.get<ArkTaskQueryResponse>(
      `/contents/generations/tasks/${encodeURIComponent(upstreamTaskId)}`
    );
    return mapArkTaskState(res);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }
  private async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${arkConfig.baseUrl()}${path}`, {
        method,
        headers: this.headers(),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new ProviderError(
        "network_error",
        `连接火山方舟失败：${(e as Error).message}`,
        true
      );
    }
    const text = await res.text();
    if (!res.ok) {
      throw mapHttpError(res.status, text);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ProviderError("upstream_error", "火山方舟返回了非 JSON 响应");
    }
  }
}

const TEXT_SYSTEM_PROMPT =
  "你是专业的影视创作助手，根据用户需求生成高质量的中文文本（剧情、角色设定、提示词等）。直接输出正文，不要寒暄。";

const SCRIPT_SYSTEM_PROMPT = `你是专业的分镜师。根据用户的剧情描述生成分镜脚本。
严格输出一个 JSON 数组（不要包裹 markdown 代码块以外的任何文字），数组中每个元素形如：
{"scene":"场景名","shotType":"景别(远景/全景/中景/近景/特写)","description":"该镜头的详细画面描述(适合直接作为AI绘画提示词)","cameraMove":"运镜方式"}
生成 4-8 个镜头，保持叙事连贯。`;

/** 纯函数：解析 LLM 输出的分镜 JSON（容忍 markdown 代码块包裹），供契约测试覆盖。 */
export function parseScriptShots(content: string): ShotRow[] {
  // 剥掉 ```json ... ``` 围栏，或截取首个 [ 到末个 ] 之间的内容
  let raw = content.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const arr = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (s): s is Record<string, unknown> => !!s && typeof s === "object"
      )
      .map((s, i) => ({
        id: `shot-${i + 1}`,
        scene: String(s.scene ?? `场景 ${i + 1}`),
        shotType: String(s.shotType ?? "中景"),
        description: String(s.description ?? ""),
        cameraMove: String(s.cameraMove ?? "固定机位"),
      }))
      .filter((s) => s.description);
  } catch {
    return [];
  }
}

/** 纯函数：把 Seedance 任务查询响应映射为统一运行态（供契约测试直接覆盖）。 */
export function mapArkTaskState(res: ArkTaskQueryResponse): ProviderTaskState {
  const status = res.status ?? "running";
  if (status === "succeeded") {
    const url = res.content?.video_url;
    if (!url) {
      return {
        status: "failed",
        error: { code: "upstream_error", message: "任务成功但未返回视频地址" },
      };
    }
    return { status: "succeeded", progress: 100, outputs: [{ type: "video", url }] };
  }
  if (status === "failed" || status === "cancelled") {
    return {
      status: "failed",
      error: {
        code: "upstream_error",
        message: res.error?.message ?? "Seedance 任务失败",
      },
    };
  }
  // queued / running
  return { status: "running" };
}
