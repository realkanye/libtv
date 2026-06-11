// 可灵（快手 Kling）Provider。
// 鉴权：AccessKey/SecretKey 服务端签发短时效 JWT（见 jwt.ts），浏览器永不接触密钥。
// 全部为异步任务（创建→轮询）。支持文生视频 / 图生视频(首帧) / 首尾帧。
//
// 查询接口按任务类型分路径，因此把类型编进 upstreamTaskId（"text2video:<id>"），
// 轮询时再解析。接口形态依据可灵开放平台公开文档整理，契约测试覆盖映射逻辑。

import { klingConfig } from "@/lib/server/env";
import { signKlingToken } from "./jwt";
import type {
  CreateTaskResult,
  GenerationProvider,
  ModelCapability,
  ProviderTaskState,
  UnifiedRequest,
} from "./types";
import { ProviderError } from "./types";
import { CATALOG } from "./catalog";

type KlingEndpoint = "text2video" | "image2video" | "images";

interface KlingCreateResponse {
  code?: number;
  message?: string;
  data?: { task_id?: string; task_status?: string };
}

interface KlingQueryResponse {
  code?: number;
  message?: string;
  data?: {
    task_id?: string;
    task_status?: string; // submitted | processing | succeed | failed
    task_status_msg?: string;
    task_result?: {
      videos?: { id?: string; url?: string }[];
      images?: { index?: number; url?: string }[];
    };
  };
}

/** 把可灵图片入参标准化：data URI 取 base64，其余按 URL 透传。 */
export function klingImageField(image: string): string {
  const m = image.match(/^data:[^;]+;base64,(.*)$/);
  return m ? m[1] : image;
}

function mapHttpError(status: number, body: string): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError(
      "auth_failed",
      "可灵鉴权失败，请检查 AccessKey/SecretKey"
    );
  }
  if (status === 429) {
    return new ProviderError("rate_limited", "可灵触发限流，请稍后重试", true);
  }
  return new ProviderError(
    "upstream_error",
    `可灵返回错误（${status}）：${body.slice(0, 200)}`
  );
}

/** 业务码（HTTP 200 但 code!=0）映射。 */
function mapBizError(code: number, message: string): ProviderError {
  if (code === 1102 || code === 1103 || code === 1100) {
    return new ProviderError("quota_exceeded", `可灵账户异常：${message}`);
  }
  if (code === 1303 || code === 1304) {
    return new ProviderError("rate_limited", "可灵触发限流，请稍后重试", true);
  }
  if (code === 1301) {
    return new ProviderError("content_rejected", "内容未通过审核，请调整提示词");
  }
  return new ProviderError("upstream_error", `可灵返回错误（${code}）：${message}`);
}

export class KlingProvider implements GenerationProvider {
  readonly id = "kling" as const;
  readonly label = "可灵 Kling";

  isConfigured(): boolean {
    return !!klingConfig.accessKey() && !!klingConfig.secretKey();
  }

  capabilities(): ModelCapability[] {
    return CATALOG.filter((c) => c.providerId === "kling");
  }

  private token(): string {
    const ak = klingConfig.accessKey();
    const sk = klingConfig.secretKey();
    if (!ak || !sk) {
      throw new ProviderError(
        "not_configured",
        "未配置 KLING_ACCESS_KEY / KLING_SECRET_KEY"
      );
    }
    return signKlingToken(ak, sk);
  }

  async createTask(req: UnifiedRequest): Promise<CreateTaskResult> {
    if (req.mode === "text-to-image" || req.mode === "image-to-image") {
      return this.createImage(req);
    }
    const endpoint: KlingEndpoint =
      req.mode === "text-to-video" ? "text2video" : "image2video";

    const body: Record<string, unknown> = {
      model_name: req.modelId,
      prompt: req.prompt || undefined,
      duration: String(req.params?.duration ?? 5),
      aspect_ratio: req.params?.aspectRatio ?? "16:9",
      mode: "std",
      cfg_scale: 0.5,
    };

    if (endpoint === "image2video") {
      const images = req.images ?? [];
      body.image = klingImageField(images[0]);
      // 首尾帧：第二张作为尾帧
      if (req.mode === "keyframe-video" && images[1]) {
        body.image_tail = klingImageField(images[1]);
      }
    }

    const res = await this.post<KlingCreateResponse>(`/v1/videos/${endpoint}`, body);
    const taskId = res.data?.task_id;
    if (!taskId) {
      throw new ProviderError("upstream_error", "可灵未返回 task_id");
    }
    // 把端点编进 id，供轮询时选择查询路径。
    return { kind: "async", upstreamTaskId: `${endpoint}:${taskId}` };
  }

  /** 可灵生图（异步任务）。 */
  private async createImage(req: UnifiedRequest): Promise<CreateTaskResult> {
    const body: Record<string, unknown> = {
      model_name: req.modelId,
      prompt: req.prompt,
      aspect_ratio: req.params?.aspectRatio ?? "16:9",
      n: req.params?.count ?? 1,
    };
    if (req.images?.[0]) {
      body.image = klingImageField(req.images[0]);
    }
    const res = await this.post<KlingCreateResponse>(
      "/v1/images/generations",
      body
    );
    const taskId = res.data?.task_id;
    if (!taskId) {
      throw new ProviderError("upstream_error", "可灵未返回 task_id");
    }
    return { kind: "async", upstreamTaskId: `images:${taskId}` };
  }

  async getTask(upstreamTaskId: string): Promise<ProviderTaskState> {
    const [endpoint, ...rest] = upstreamTaskId.split(":");
    const taskId = rest.join(":");
    const path =
      endpoint === "images"
        ? `/v1/images/generations/${encodeURIComponent(taskId)}`
        : `/v1/videos/${endpoint}/${encodeURIComponent(taskId)}`;
    const res = await this.get<KlingQueryResponse>(path);
    return mapKlingTaskState(res);
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
      res = await fetch(`${klingConfig.baseUrl()}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token()}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new ProviderError(
        "network_error",
        `连接可灵失败：${(e as Error).message}`,
        true
      );
    }
    const text = await res.text();
    if (!res.ok) {
      throw mapHttpError(res.status, text);
    }
    let json: T & { code?: number; message?: string };
    try {
      json = JSON.parse(text);
    } catch {
      throw new ProviderError("upstream_error", "可灵返回了非 JSON 响应");
    }
    if (typeof json.code === "number" && json.code !== 0) {
      throw mapBizError(json.code, json.message ?? "");
    }
    return json;
  }
}

/** 纯函数：把可灵任务查询响应映射为统一运行态（契约测试直接覆盖）。 */
export function mapKlingTaskState(res: KlingQueryResponse): ProviderTaskState {
  const status = res.data?.task_status;
  if (status === "succeed") {
    const result = res.data?.task_result;
    const videoOutputs = (result?.videos ?? [])
      .filter((v) => v.url)
      .map((v) => ({ type: "video" as const, url: v.url! }));
    const imageOutputs = (result?.images ?? [])
      .filter((i) => i.url)
      .map((i) => ({ type: "image" as const, url: i.url! }));
    const outputs = [...videoOutputs, ...imageOutputs];
    if (!outputs.length) {
      return {
        status: "failed",
        error: { code: "upstream_error", message: "任务成功但未返回产物地址" },
      };
    }
    return { status: "succeeded", progress: 100, outputs };
  }
  if (status === "failed") {
    return {
      status: "failed",
      error: {
        code: "upstream_error",
        message: res.data?.task_status_msg ?? "可灵任务失败",
      },
    };
  }
  return { status: "running" };
}
