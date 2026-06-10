import type { Node } from "@xyflow/react";
import type { GenerationParams, ProviderId } from "./providers/types";

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
  /** 选中的 Provider 与模型（由能力目录驱动）。 */
  providerId: ProviderId;
  modelId: string;
  /** 生成参数（画幅比/时长/张数/分辨率），由模型能力声明决定可见项。 */
  params: GenerationParams;
  /** 生成或上传的内容：text 为正文，image/video/audio 为 URL，script 为分镜行。 */
  content: string | null;
  shots: ShotRow[] | null;
  status: "idle" | "queued" | "generating" | "done" | "error";
  /** 0–100。 */
  progress: number;
  /** 失败原因（中文人话）。 */
  errorMessage: string | null;
  /** 当前关联的任务 ID（用于订阅状态流 / 刷新恢复）。 */
  taskId: string | null;
}

export type LibNode = Node<LibNodeData>;

/** 节点展示元信息（模型不在此声明，统一由能力目录 catalog 提供）。 */
export const NODE_KIND_META: Record<
  NodeKind,
  { label: string; icon: string; accent: string }
> = {
  text: { label: "文本", icon: "📝", accent: "#3b82f6" },
  image: { label: "图片", icon: "🖼️", accent: "#8b5cf6" },
  video: { label: "视频", icon: "🎥", accent: "#f59e0b" },
  audio: { label: "音频", icon: "🎵", accent: "#10b981" },
  script: { label: "脚本", icon: "🎬", accent: "#ef4444" },
};
