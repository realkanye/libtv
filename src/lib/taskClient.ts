"use client";

// 客户端任务管理中枢：所有生成（节点按钮 / 脚本流水线 / 整组执行 / 合成）
// 都经由 startGeneration 走同一条链路 —— 构造请求 → 本地校验 → POST →
// SSE 订阅 → 写回节点。刷新后由 resumeActiveTasks 恢复进行中的任务。

import { useCanvasStore } from "./store";
import { resolveMode } from "./providers/catalog";
import { validateAndNormalize } from "./providers/validate";
import type { EditParams, ModelCapability } from "./providers/types";
import type { LibNodeData } from "./types";
import type { TaskView } from "./tasks/types";

const TASK_STATUS_TO_NODE: Record<TaskView["status"], LibNodeData["status"]> = {
  queued: "queued",
  running: "generating",
  succeeded: "done",
  failed: "error",
};

/** taskId → EventSource，防止重复订阅。 */
const streams = new Map<string, EventSource>();

function applyView(nodeId: string, view: TaskView) {
  const { updateNodeData } = useCanvasStore.getState();
  const patch: Partial<LibNodeData> = {
    status: TASK_STATUS_TO_NODE[view.status],
    progress: view.progress,
  };
  if (view.status === "succeeded") {
    const out = view.outputs[0];
    if (out) {
      patch.content = out.url ?? out.text ?? null;
      patch.shots = out.shots ?? null;
    }
    patch.errorMessage = null;
  } else if (view.status === "failed") {
    patch.errorMessage = view.error?.message ?? "生成失败";
  }
  updateNodeData(nodeId, patch);
}

function closeStream(taskId: string) {
  streams.get(taskId)?.close();
  streams.delete(taskId);
}

/** 订阅任务 SSE 流，终态时 resolve（true=成功）。 */
export function subscribeTask(taskId: string, nodeId: string): Promise<boolean> {
  closeStream(taskId);
  return new Promise<boolean>((resolve) => {
    const es = new EventSource(`/api/tasks/${taskId}/stream`);
    streams.set(taskId, es);
    es.onmessage = (ev) => {
      let view: TaskView;
      try {
        view = JSON.parse(ev.data) as TaskView;
      } catch {
        return;
      }
      applyView(nodeId, view);
      if (view.status === "succeeded" || view.status === "failed") {
        closeStream(taskId);
        resolve(view.status === "succeeded");
      }
    };
    es.addEventListener("notfound", () => {
      useCanvasStore.getState().updateNodeData(nodeId, {
        status: "error",
        errorMessage: "任务不存在或已过期",
      });
      closeStream(taskId);
      resolve(false);
    });
    es.onerror = () => {
      // SSE 断线（如服务重启）：回退到单次查询，不让节点卡死
      closeStream(taskId);
      void pollOnce(taskId, nodeId).then(resolve);
    };
  });
}

async function pollOnce(taskId: string, nodeId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/tasks/${taskId}`);
    if (!res.ok) throw new Error();
    const view = (await res.json()) as TaskView;
    applyView(nodeId, view);
    if (view.status === "succeeded") return true;
    if (view.status === "failed") return false;
    // 仍在进行中 → 重新订阅
    return subscribeTask(taskId, nodeId);
  } catch {
    useCanvasStore.getState().updateNodeData(nodeId, {
      status: "error",
      errorMessage: "连接中断，请点击重试",
    });
    return false;
  }
}

/**
 * 发起节点生成。返回 Promise（true=成功），供流水线/整组执行串联。
 * 校验失败/请求失败会把错误写到节点上并返回 false。
 */
export async function startGeneration(nodeId: string): Promise<boolean> {
  const store = useCanvasStore.getState();
  const node = store.nodes.find((n) => n.id === nodeId);
  if (!node) return false;
  const { data } = node;
  if (data.status === "queued" || data.status === "generating") return false;

  const inputs = store.upstreamInputs(nodeId);
  const mode = resolveMode(data.kind, inputs.images.length, inputs.videos.length);
  const payload = {
    nodeId,
    providerId: data.providerId,
    modelId: data.modelId,
    mode,
    prompt: data.prompt,
    images: inputs.images,
    videos: inputs.videos,
    audios: inputs.audios,
    refTexts: inputs.refTexts,
    params: data.params,
  };

  // 与服务端同一套校验（单一真相源），失败时错误就地呈现
  const check = validateAndNormalize(payload);
  if (!check.ok) {
    store.updateNodeData(nodeId, { status: "error", errorMessage: check.message });
    return false;
  }

  store.updateNodeData(nodeId, {
    status: "queued",
    progress: 0,
    errorMessage: null,
  });
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok) {
      store.updateNodeData(nodeId, {
        status: "error",
        errorMessage: body.error ?? `请求失败（${res.status}）`,
      });
      return false;
    }
    store.updateNodeData(nodeId, { taskId: body.taskId });
    return await subscribeTask(body.taskId, nodeId);
  } catch {
    store.updateNodeData(nodeId, {
      status: "error",
      errorMessage: "网络错误，请重试",
    });
    return false;
  }
}

/** 重试：服务端按原始请求重跑（无任务记录则按当前节点状态重新发起）。 */
export async function retryGeneration(nodeId: string): Promise<boolean> {
  const store = useCanvasStore.getState();
  const node = store.nodes.find((n) => n.id === nodeId);
  if (!node) return false;
  const taskId = node.data.taskId;
  if (taskId) {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: "POST" });
      if (res.ok) {
        store.updateNodeData(nodeId, {
          status: "queued",
          progress: 0,
          errorMessage: null,
        });
        return await subscribeTask(taskId, nodeId);
      }
    } catch {
      // 服务端任务已丢失 → 走全新生成
    }
  }
  return startGeneration(nodeId);
}

/**
 * 媒体编辑工具：对源节点内容应用 ffmpeg 工具（裁取/提取/变速），
 * 产出一个新结果节点（连线自源节点，便于溯源）。返回是否成功。
 */
export async function startToolGeneration(
  sourceNodeId: string,
  tool: ModelCapability,
  edit: EditParams
): Promise<boolean> {
  const store = useCanvasStore.getState();
  const source = store.nodes.find((n) => n.id === sourceNodeId);
  if (!source || source.data.status !== "done" || !source.data.content) {
    return false;
  }
  const mode = tool.modes[0];
  const fromVideo = mode === "video-trim" || mode === "extract-audio";

  // 结果节点用默认模型（普通可再编辑节点），仅承载产物
  const resultId = store.addNode(
    tool.kind,
    {
      x: source.position.x + 360,
      y: source.position.y + 40,
    },
    { status: "queued", progress: 0 }
  );
  useCanvasStore.getState().addEdgeBetween(sourceNodeId, resultId);

  const payload = {
    nodeId: resultId,
    providerId: tool.providerId,
    modelId: tool.modelId,
    mode,
    prompt: "",
    videos: fromVideo ? [source.data.content] : undefined,
    audios: fromVideo ? undefined : [source.data.content],
    edit,
    params: {},
  };
  const check = validateAndNormalize(payload);
  if (!check.ok) {
    useCanvasStore.getState().updateNodeData(resultId, {
      status: "error",
      errorMessage: check.message,
    });
    return false;
  }
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok) {
      useCanvasStore.getState().updateNodeData(resultId, {
        status: "error",
        errorMessage: body.error ?? `请求失败（${res.status}）`,
      });
      return false;
    }
    useCanvasStore.getState().updateNodeData(resultId, { taskId: body.taskId });
    return await subscribeTask(body.taskId, resultId);
  } catch {
    useCanvasStore.getState().updateNodeData(resultId, {
      status: "error",
      errorMessage: "网络错误，请重试",
    });
    return false;
  }
}

/** 画布注水完成后调用：恢复刷新前进行中的任务。 */
export function resumeActiveTasks() {
  const store = useCanvasStore.getState();
  for (const node of store.nodes) {
    const { status, taskId } = node.data;
    if (status !== "queued" && status !== "generating") continue;
    if (taskId) {
      void pollOnce(taskId, node.id);
    } else {
      store.updateNodeData(node.id, {
        status: "error",
        errorMessage: "生成已中断，请重试",
      });
    }
  }
}

/** 当前节点生成态资源是否需要清理（节点删除时调用）。 */
export function releaseNodeStreams(taskIds: (string | null)[]) {
  for (const id of taskIds) {
    if (id) closeStream(id);
  }
}
