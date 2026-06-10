// 模型能力目录 —— 全应用唯一的「真相源」。
//
// 纯数据，无副作用、无 Node 依赖。服务端各 Provider 按 providerId 取自己的切片；
// 客户端用它渲染模型下拉与参数面板。新增模型 = 往这里加一条声明。

import type { NodeKind } from "@/lib/types";
import type { GenerationMode, ModelCapability, ProviderId } from "./types";

const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"];

export const CATALOG: ModelCapability[] = [
  // ───────────── Mock：始终可用，保证离线 / 演示 / 测试不依赖外部服务 ─────────────
  {
    providerId: "mock",
    modelId: "mock-text",
    label: "Mock 文本",
    kind: "text",
    modes: ["text-to-text"],
    sync: true,
    params: {},
    note: "本地模拟，无需密钥",
  },
  {
    providerId: "mock",
    modelId: "mock-script",
    label: "Mock 分镜",
    kind: "script",
    modes: ["text-to-script"],
    sync: true,
    params: {},
    note: "本地模拟，无需密钥",
  },
  {
    providerId: "mock",
    modelId: "mock-audio",
    label: "Mock 音频",
    kind: "audio",
    modes: ["text-to-audio"],
    sync: true,
    params: {},
    note: "本地模拟，无需密钥",
  },
  {
    providerId: "mock",
    modelId: "mock-image",
    label: "Mock 图片",
    kind: "image",
    modes: ["text-to-image", "image-to-image"],
    sync: true,
    imageInputs: { "image-to-image": { min: 1, max: 4 } },
    params: {
      aspectRatio: { options: ASPECT_RATIOS, default: "16:9" },
      count: { options: [1, 2, 4], default: 1 },
    },
    note: "本地模拟，无需密钥",
  },
  {
    providerId: "mock",
    modelId: "mock-video",
    label: "Mock 视频",
    kind: "video",
    modes: ["text-to-video", "image-to-video", "keyframe-video"],
    sync: false,
    imageInputs: {
      "image-to-video": { min: 1, max: 1 },
      "keyframe-video": { min: 2, max: 2 },
    },
    params: {
      aspectRatio: { options: ASPECT_RATIOS, default: "16:9" },
      duration: { options: [5, 10], default: 5 },
    },
    note: "本地模拟，无需密钥（模拟异步轮询）",
  },

  // ───────────── 火山方舟（即梦 / 字节）─────────────
  {
    providerId: "ark",
    modelId: "doubao-seedream-4-0",
    label: "Seedream 4.0（即梦）",
    kind: "image",
    modes: ["text-to-image", "image-to-image"],
    sync: true, // Seedream 图片同步出图
    imageInputs: { "image-to-image": { min: 1, max: 4 } },
    params: {
      aspectRatio: { options: ASPECT_RATIOS, default: "16:9" },
      count: { options: [1, 2, 4], default: 1 },
      resolution: { options: ["1K", "2K", "4K"], default: "2K" },
    },
    note: "火山方舟同步出图",
  },
  {
    providerId: "ark",
    modelId: "doubao-seedance-1-0-pro",
    label: "Seedance 1.0 Pro（即梦）",
    kind: "video",
    modes: ["text-to-video", "image-to-video"],
    sync: false,
    imageInputs: { "image-to-video": { min: 1, max: 1 } },
    params: {
      aspectRatio: { options: ASPECT_RATIOS, default: "16:9" },
      duration: { options: [5, 10], default: 5 },
      resolution: { options: ["480p", "720p", "1080p"], default: "720p" },
    },
    note: "火山方舟异步任务；如有 Seedance 2.0 公测资格可在环境变量中改模型 ID",
  },

  // ───────────── 可灵（快手 Kling）─────────────
  {
    providerId: "kling",
    modelId: "kling-v2-5-turbo",
    label: "Kling v2.5 Turbo（可灵）",
    kind: "video",
    modes: ["text-to-video", "image-to-video", "keyframe-video"],
    sync: false,
    imageInputs: {
      "image-to-video": { min: 1, max: 1 },
      "keyframe-video": { min: 2, max: 2 },
    },
    params: {
      aspectRatio: { options: ["16:9", "9:16", "1:1"], default: "16:9" },
      duration: { options: [5, 10], default: 5 },
    },
    note: "可灵开放平台异步任务（JWT 鉴权）",
  },
];

/** 稳定的能力键，用作前端下拉的 value 与节点存储。 */
export function capabilityKey(c: {
  providerId: ProviderId;
  modelId: string;
}): string {
  return `${c.providerId}:${c.modelId}`;
}

export function findCapability(
  providerId: ProviderId,
  modelId: string
): ModelCapability | undefined {
  return CATALOG.find(
    (c) => c.providerId === providerId && c.modelId === modelId
  );
}

export function findCapabilityByKey(key: string): ModelCapability | undefined {
  return CATALOG.find((c) => capabilityKey(c) === key);
}

/** 某节点类型下的全部模型能力。 */
export function capabilitiesForKind(kind: NodeKind): ModelCapability[] {
  return CATALOG.filter((c) => c.kind === kind);
}

/** 某节点类型的默认模型 —— 永远返回 Mock，保证无密钥时即可用。 */
export function defaultCapabilityForKind(kind: NodeKind): ModelCapability {
  const list = capabilitiesForKind(kind);
  const mock = list.find((c) => c.providerId === "mock");
  return mock ?? list[0];
}

/**
 * 根据「连入的参考图数量」推导生成模式。
 * 连线语义：图片连视频=图生视频(首帧)；两张图=首尾帧；纯文本=文生。
 */
export function resolveMode(kind: NodeKind, imageCount: number): GenerationMode {
  switch (kind) {
    case "text":
      return "text-to-text";
    case "script":
      return "text-to-script";
    case "audio":
      return "text-to-audio";
    case "image":
      return imageCount >= 1 ? "image-to-image" : "text-to-image";
    case "video":
      if (imageCount >= 2) return "keyframe-video";
      if (imageCount === 1) return "image-to-video";
      return "text-to-video";
  }
}
