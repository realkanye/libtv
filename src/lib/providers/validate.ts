// 请求校验与归一化层。
//
// 不合法的请求在这里就被拦下，根本不会发到上游 —— 这是「消灭一大类 Bug」的关键。
// 校验完全由能力声明（catalog）驱动，错误信息是中文人话而非上游原始报错。

import { z } from "zod";
import { findCapability } from "./catalog";
import type { GenerationParams, ModelCapability, UnifiedRequest } from "./types";
import type { GenerationMode } from "./types";

const MODE_LABELS: Record<GenerationMode, string> = {
  "text-to-text": "文生文",
  "text-to-script": "文生分镜",
  "text-to-audio": "文生音频",
  "text-to-image": "文生图",
  "image-to-image": "图生图（多图参考）",
  "text-to-video": "文生视频",
  "image-to-video": "图生视频（首帧）",
  "keyframe-video": "首尾帧视频",
  "compose-video": "视频合成",
};

const envelopeSchema = z.object({
  providerId: z.enum(["mock", "ark", "kling", "local"]),
  modelId: z.string().min(1),
  mode: z.enum([
    "text-to-text",
    "text-to-script",
    "text-to-audio",
    "text-to-image",
    "image-to-image",
    "text-to-video",
    "image-to-video",
    "keyframe-video",
    "compose-video",
  ]),
  prompt: z.string(),
  images: z.array(z.string()).optional(),
  videos: z.array(z.string()).optional(),
  audios: z.array(z.string()).optional(),
  refTexts: z.array(z.string()).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export type ValidationResult =
  | { ok: true; value: UnifiedRequest; capability: ModelCapability }
  | { ok: false; message: string };

function fail(message: string): ValidationResult {
  return { ok: false, message };
}

/** 模式是否需要参考图（文生类不需要）。 */
function needsImages(mode: GenerationMode): boolean {
  return (
    mode === "image-to-image" ||
    mode === "image-to-video" ||
    mode === "keyframe-video"
  );
}

/**
 * 校验并归一化请求：套用参数默认值、裁掉模型不声明的参数、校验连线与取值范围。
 * 返回归一化后的请求供 Provider 直接使用。
 */
export function validateAndNormalize(input: unknown): ValidationResult {
  const parsed = envelopeSchema.safeParse(input);
  if (!parsed.success) {
    return fail("生成请求格式不正确");
  }
  const req = parsed.data;

  const capability = findCapability(req.providerId, req.modelId, req.mode);
  if (!capability) {
    return fail(`未找到模型「${req.modelId}」`);
  }

  // 1) 模式必须被该模型支持
  if (!capability.modes.includes(req.mode)) {
    const supported = capability.modes
      .map((m) => MODE_LABELS[m])
      .join("、");
    return fail(
      `「${capability.label}」不支持${MODE_LABELS[req.mode]}，仅支持：${supported}`
    );
  }

  // 2) 参考图数量校验
  const images = (req.images ?? []).filter((s) => s && s.trim());
  if (needsImages(req.mode)) {
    const spec = capability.imageInputs?.[req.mode];
    if (!spec) {
      return fail(`「${capability.label}」未声明${MODE_LABELS[req.mode]}的图片要求`);
    }
    if (images.length < spec.min) {
      const hint =
        req.mode === "keyframe-video"
          ? "需要连入两张图片（首帧在前、尾帧在后）"
          : `需要连入至少 ${spec.min} 张图片`;
      return fail(`${MODE_LABELS[req.mode]}${hint}，当前 ${images.length} 张`);
    }
    if (images.length > spec.max) {
      return fail(
        `${MODE_LABELS[req.mode]}最多接入 ${spec.max} 张图片，当前 ${images.length} 张`
      );
    }
  }

  // 3) 视频/音频输入校验（视频合成用）
  const videos = (req.videos ?? []).filter((s) => s && s.trim());
  const audios = (req.audios ?? []).filter((s) => s && s.trim());
  if (req.mode === "compose-video") {
    const spec = capability.videoInputs?.[req.mode];
    if (!spec) {
      return fail(`「${capability.label}」未声明视频合成的输入要求`);
    }
    if (videos.length < spec.min) {
      return fail(`视频合成需要连入至少 ${spec.min} 个视频，当前 ${videos.length} 个`);
    }
    if (videos.length > spec.max) {
      return fail(`视频合成最多接入 ${spec.max} 个视频，当前 ${videos.length} 个`);
    }
  } else if (videos.length > 0) {
    return fail(`「${capability.label}」不支持视频输入，请断开视频连线或改用视频合成`);
  }
  const maxAudio = capability.maxAudioInputs ?? 0;
  if (audios.length > maxAudio) {
    return fail(
      maxAudio === 0
        ? `「${capability.label}」不支持音频输入，请断开音频连线`
        : `「${capability.label}」最多接入 ${maxAudio} 条音频，当前 ${audios.length} 条`
    );
  }

  // 4) 提示词：文生类必填（合成无需提示词）
  const prompt = req.prompt.trim();
  if (!needsImages(req.mode) && req.mode !== "compose-video" && !prompt) {
    return fail("请输入提示词");
  }

  // 5) 参数归一化（只保留模型声明的参数，并校验取值）
  const rawParams = (req.params ?? {}) as Record<string, unknown>;
  const params: GenerationParams = {};
  const spec = capability.params;

  if (spec.aspectRatio) {
    const v = rawParams.aspectRatio;
    const value = typeof v === "string" ? v : spec.aspectRatio.default;
    if (!spec.aspectRatio.options.includes(value)) {
      return fail(`画幅比「${value}」不被「${capability.label}」支持`);
    }
    params.aspectRatio = value;
  }
  if (spec.duration) {
    const v = rawParams.duration;
    const value = typeof v === "number" ? v : spec.duration.default;
    if (!spec.duration.options.includes(value)) {
      return fail(`时长「${value}s」不被「${capability.label}」支持`);
    }
    params.duration = value;
  }
  if (spec.count) {
    const v = rawParams.count;
    const value = typeof v === "number" ? v : spec.count.default;
    if (!spec.count.options.includes(value)) {
      return fail(`出图张数「${value}」不被「${capability.label}」支持`);
    }
    params.count = value;
  }
  if (spec.resolution) {
    const v = rawParams.resolution;
    const value = typeof v === "string" ? v : spec.resolution.default;
    if (!spec.resolution.options.includes(value)) {
      return fail(`分辨率「${value}」不被「${capability.label}」支持`);
    }
    params.resolution = value;
  }

  const value: UnifiedRequest = {
    providerId: req.providerId,
    modelId: req.modelId,
    mode: req.mode,
    prompt,
    images: needsImages(req.mode) ? images : undefined,
    videos: req.mode === "compose-video" ? videos : undefined,
    audios: audios.length ? audios : undefined,
    refTexts: req.refTexts?.filter((s) => s && s.trim()),
    params,
  };

  return { ok: true, value, capability };
}
