// 异步任务中枢的数据结构。

import type {
  GenerationMode,
  GenerationOutput,
  ProviderErrorCode,
  ProviderId,
  UnifiedRequest,
} from "@/lib/providers/types";

export type TaskStatus = "queued" | "running" | "succeeded" | "failed";

/** 服务端持久化的完整任务记录。 */
export interface TaskRecord {
  id: string;
  /** 发起生成的画布节点。 */
  nodeId: string;
  request: UnifiedRequest;
  providerId: ProviderId;
  modelId: string;
  mode: GenerationMode;
  /** 上游任务 ID（异步任务才有）。 */
  upstreamTaskId?: string;
  status: TaskStatus;
  /** 0–100。 */
  progress: number;
  outputs: GenerationOutput[];
  error?: { code: ProviderErrorCode; message: string };
  /** 已轮询次数（用于指数退避）。 */
  attempts: number;
  createdAt: number;
  updatedAt: number;
  /** 下次允许轮询的时间戳（ms）。 */
  nextPollAt: number;
  /** 超过此时间仍未完成则判定超时。 */
  expiresAt: number;
}

/** 下发给前端的精简视图（不含密钥相关的请求细节）。 */
export interface TaskView {
  id: string;
  nodeId: string;
  status: TaskStatus;
  progress: number;
  outputs: GenerationOutput[];
  error?: { code: ProviderErrorCode; message: string };
}

export function toView(t: TaskRecord): TaskView {
  return {
    id: t.id,
    nodeId: t.nodeId,
    status: t.status,
    progress: t.progress,
    outputs: t.outputs,
    error: t.error,
  };
}

export function isTerminal(status: TaskStatus): boolean {
  return status === "succeeded" || status === "failed";
}
