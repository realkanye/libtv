// Provider 抽象层的核心契约。
//
// 本文件刻意保持「纯类型 + 纯数据」，不引入任何 Node 专属模块
// （crypto / fs / next 等），因此既可在服务端 Provider 实现里使用，
// 也可被客户端组件安全导入用于渲染。具体的 Provider 实现（含密钥、
// 网络请求、签名）放在各自的 *.ts 中，永远只在服务端运行。

import type { NodeKind, ShotRow } from "@/lib/types";

/** 已登记的 Provider 标识。新增 Provider 时在此扩展。 */
export type ProviderId = "mock" | "ark" | "kling";

/**
 * 统一生成模式。画布上的「连线语义」最终都会被解析成其中之一，
 * 再由能力声明决定某个模型是否支持。
 */
export type GenerationMode =
  | "text-to-text"
  | "text-to-script"
  | "text-to-audio"
  | "text-to-image"
  | "image-to-image" // 多图参考生图
  | "text-to-video"
  | "image-to-video" // 单图首帧
  | "keyframe-video"; // 首尾帧

/** 某个模式对「输入参考图数量」的要求。 */
export interface ImageInputSpec {
  min: number;
  max: number;
}

/** 声明式参数规格：前端参数面板据此渲染，校验层据此校验。 */
export interface ParamSpec {
  aspectRatio?: { options: string[]; default: string };
  /** 时长（秒），仅视频类模型声明。 */
  duration?: { options: number[]; default: number };
  /** 出图张数，仅图片类模型声明。 */
  count?: { options: number[]; default: number };
  resolution?: { options: string[]; default: string };
}

/**
 * 模型能力声明 —— 整个架构的「真相源」。
 * 前端的模型下拉、参数面板、连线校验，以及服务端的请求校验，
 * 全部由这份声明驱动，从根本上消灭「参数不合法被上游打回」这类 Bug。
 */
export interface ModelCapability {
  providerId: ProviderId;
  /** 调用上游 API 时使用的真实模型 ID。 */
  modelId: string;
  /** 展示名。 */
  label: string;
  /** 归属的画布节点类型。 */
  kind: NodeKind;
  /** 支持的生成模式。 */
  modes: GenerationMode[];
  /** true 表示创建即同步返回产物（如 Seedream 出图）；false 表示异步任务（创建→轮询）。 */
  sync: boolean;
  /** 各模式对参考图数量的要求；未列出的模式视为不需要图片。 */
  imageInputs?: Partial<Record<GenerationMode, ImageInputSpec>>;
  params: ParamSpec;
  /** 可选说明，展示在参数面板里。 */
  note?: string;
}

/** 归一化后的生成参数（已套用默认值、已校验）。 */
export interface GenerationParams {
  aspectRatio?: string;
  duration?: number;
  count?: number;
  resolution?: string;
}

/** 统一生成请求。画布节点永远只构造这个结构，不接触任何上游 API 细节。 */
export interface UnifiedRequest {
  providerId: ProviderId;
  modelId: string;
  mode: GenerationMode;
  prompt: string;
  /** 上游图片节点的内容（URL 或 data URI），顺序有意义（首帧在前，尾帧在后）。 */
  images?: string[];
  /** 上游文本/脚本节点的内容，作为提示词增强。 */
  refTexts?: string[];
  params?: GenerationParams;
}

/** 单个产物。type 对齐节点类型以便前端直接渲染。 */
export interface GenerationOutput {
  type: NodeKind;
  /** image/video/audio 的地址。 */
  url?: string;
  /** text 的正文。 */
  text?: string;
  /** script 的分镜行。 */
  shots?: ShotRow[];
}

/** 统一的错误码，便于前端把上游报错翻译成中文人话。 */
export type ProviderErrorCode =
  | "not_configured" // 未配置密钥
  | "invalid_request" // 参数/连线不合法（本层拦截）
  | "auth_failed" // 鉴权失败
  | "quota_exceeded" // 余额/积分不足
  | "content_rejected" // 内容审核拦截
  | "rate_limited" // 触发限流
  | "timeout" // 轮询超时
  | "task_expired" // 上游任务已过期
  | "upstream_error" // 上游其它错误
  | "network_error"; // 网络异常

export class ProviderError extends Error {
  code: ProviderErrorCode;
  /** 是否可重试（如限流、网络错误）。 */
  retryable: boolean;
  constructor(code: ProviderErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

/** 创建任务的结果：同步直接给产物，异步给上游 task_id。 */
export type CreateTaskResult =
  | { kind: "sync"; outputs: GenerationOutput[] }
  | { kind: "async"; upstreamTaskId: string };

/** 上游任务的运行态（由 getTask 返回，hub 据此推进本地任务）。 */
export interface ProviderTaskState {
  status: "running" | "succeeded" | "failed";
  /** 0–100，可选。 */
  progress?: number;
  outputs?: GenerationOutput[];
  error?: { code: ProviderErrorCode; message: string };
}

/**
 * 生成 Provider 统一接口。每接一家平台就实现一个，注册到 registry。
 * 节点永远只跟这个接口对话。
 */
export interface GenerationProvider {
  readonly id: ProviderId;
  readonly label: string;
  /** 密钥是否齐备（决定模型在前端是可用还是置灰）。 */
  isConfigured(): boolean;
  /** 该 Provider 提供的全部模型能力。 */
  capabilities(): ModelCapability[];
  /** 创建生成任务。校验已在上层完成，这里只负责映射参数与发请求。 */
  createTask(req: UnifiedRequest): Promise<CreateTaskResult>;
  /** 查询异步任务状态。sync Provider 不会被调用到。 */
  getTask(upstreamTaskId: string): Promise<ProviderTaskState>;
}
