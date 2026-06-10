import type { Node } from "@xyflow/react";

export type NodeKind = "text" | "image" | "video" | "audio" | "script";

export interface ShotRow {
  id: string;
  scene: string;
  shotType: string;
  description: string;
  cameraMove: string;
}

export interface LibNodeData extends Record<string, unknown> {
  kind: NodeKind;
  prompt: string;
  model: string;
  /** 生成或上传的内容：text 为正文，image/video/audio 为 URL，script 为分镜行 */
  content: string | null;
  shots: ShotRow[] | null;
  status: "idle" | "generating" | "done" | "error";
}

export type LibNode = Node<LibNodeData>;

export const NODE_KIND_META: Record<
  NodeKind,
  { label: string; icon: string; accent: string; models: string[] }
> = {
  text: {
    label: "文本",
    icon: "📝",
    accent: "#3b82f6",
    models: ["CVLM 5.5", "GVLM 3.1", "GVLM 3.1 Flash"],
  },
  image: {
    label: "图片",
    icon: "🖼️",
    accent: "#8b5cf6",
    models: ["Lib Image", "LibNavo 2", "Seedream 5.0 Lite", "Z Image Turbo"],
  },
  video: {
    label: "视频",
    icon: "🎥",
    accent: "#f59e0b",
    models: ["Seedance 2.0", "Kling 3.0", "Wan 2.6", "Video 3.1"],
  },
  audio: {
    label: "音频",
    icon: "🎵",
    accent: "#10b981",
    models: ["Minimax 2.8", "Eleven V3", "Mureka V8"],
  },
  script: {
    label: "脚本",
    icon: "🎬",
    accent: "#ef4444",
    models: ["CVLM 5.5", "GVLM 3.1"],
  },
};
