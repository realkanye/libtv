"use client";

// 画布编排层：脚本流水线（脚本→批量分镜图→批量视频）、整组执行、视频合成节点。
// 全部复用 taskClient.startGeneration —— 与手动点「生成」完全同一条链路。

import { useCanvasStore } from "./store";
import { startGeneration } from "./taskClient";
import { defaultCapabilityForKind, findCapability } from "./providers/catalog";
import { paramDefaults } from "./providers/params";

const GRID_X = 360; // 流水线生成节点的横向间距
const GRID_Y = 240; // 纵向间距

/** 并发上限：避免一次脚本 8 镜 ×2 段流水把上游打挂。 */
async function runLimited<T>(
  tasks: (() => Promise<T>)[],
  limit = 3
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    async () => {
      while (next < tasks.length) {
        const i = next++;
        results[i] = await tasks[i]();
      }
    }
  );
  await Promise.all(workers);
  return results;
}

/**
 * 脚本 → 批量分镜图。
 * 为每个选中分镜建（或复用）一个图片节点，连到脚本节点之后批量生成。
 * 返回 [成功数, 总数]。
 */
export async function generateShotImages(
  scriptNodeId: string,
  shotIds?: string[]
): Promise<[number, number]> {
  const store = useCanvasStore.getState();
  const scriptNode = store.nodes.find((n) => n.id === scriptNodeId);
  const shots = scriptNode?.data.shots ?? [];
  if (!scriptNode || !shots.length) return [0, 0];

  const targets = shotIds?.length
    ? shots.filter((s) => shotIds.includes(s.id))
    : shots;
  const mapping = { ...(scriptNode.data.shotImageNodes ?? {}) };
  const base = scriptNode.position;

  const jobs: (() => Promise<boolean>)[] = [];
  targets.forEach((shot) => {
    const index = shots.findIndex((s) => s.id === shot.id);
    const prompt = `${shot.scene}：${shot.description}（景别：${shot.shotType}）`;
    // 复用已有节点（仍在画布上），否则新建
    let nodeId = mapping[shot.id];
    const exists =
      nodeId && useCanvasStore.getState().nodes.some((n) => n.id === nodeId);
    if (!exists) {
      nodeId = useCanvasStore.getState().addNode(
        "image",
        { x: base.x + 460 + GRID_X * 0, y: base.y + index * GRID_Y },
        { sourceShotId: shot.id }
      );
      useCanvasStore.getState().addEdgeBetween(scriptNodeId, nodeId);
      mapping[shot.id] = nodeId;
    }
    useCanvasStore.getState().updateNodeData(nodeId!, { prompt });
    jobs.push(() => startGeneration(nodeId!));
  });

  useCanvasStore.getState().updateNodeData(scriptNodeId, {
    shotImageNodes: mapping,
  });
  const results = await runLimited(jobs);
  return [results.filter(Boolean).length, results.length];
}

/**
 * 分镜图 → 批量视频（图生视频，首帧 = 分镜图）。
 * 仅处理已生成完成的分镜图。返回 [成功数, 总数]。
 */
export async function generateShotVideos(
  scriptNodeId: string,
  shotIds?: string[]
): Promise<[number, number]> {
  const store = useCanvasStore.getState();
  const scriptNode = store.nodes.find((n) => n.id === scriptNodeId);
  const shots = scriptNode?.data.shots ?? [];
  if (!scriptNode || !shots.length) return [0, 0];

  const imageMap = scriptNode.data.shotImageNodes ?? {};
  const videoMap = { ...(scriptNode.data.shotVideoNodes ?? {}) };
  const base = scriptNode.position;
  const targets = shotIds?.length
    ? shots.filter((s) => shotIds.includes(s.id))
    : shots;

  const jobs: (() => Promise<boolean>)[] = [];
  targets.forEach((shot) => {
    const index = shots.findIndex((s) => s.id === shot.id);
    const imageNodeId = imageMap[shot.id];
    const imageNode = useCanvasStore
      .getState()
      .nodes.find((n) => n.id === imageNodeId);
    if (!imageNode || imageNode.data.status !== "done" || !imageNode.data.content)
      return; // 分镜图未就绪，跳过

    let videoNodeId = videoMap[shot.id];
    const exists =
      videoNodeId &&
      useCanvasStore.getState().nodes.some((n) => n.id === videoNodeId);
    if (!exists) {
      videoNodeId = useCanvasStore.getState().addNode(
        "video",
        { x: base.x + 460 + GRID_X, y: base.y + index * GRID_Y },
        { sourceShotId: shot.id }
      );
      useCanvasStore.getState().addEdgeBetween(imageNodeId, videoNodeId);
      videoMap[shot.id] = videoNodeId;
    }
    useCanvasStore.getState().updateNodeData(videoNodeId!, {
      prompt: `${shot.description}，运镜：${shot.cameraMove}`,
    });
    jobs.push(() => startGeneration(videoNodeId!));
  });

  useCanvasStore.getState().updateNodeData(scriptNodeId, {
    shotVideoNodes: videoMap,
  });
  const results = await runLimited(jobs, 2);
  return [results.filter(Boolean).length, results.length];
}

/**
 * 整组执行：对选中节点按连线拓扑排序，逐层生成（上游完成才轮到下游）。
 * 跳过无提示词的纯内容节点（如上传的素材）。返回 [成功数, 执行数]。
 */
export async function runGroup(nodeIds: string[]): Promise<[number, number]> {
  const idSet = new Set(nodeIds);
  const { edges } = useCanvasStore.getState();
  const inner = edges.filter((e) => idSet.has(e.source) && idSet.has(e.target));

  // Kahn 拓扑分层
  const indegree = new Map<string, number>();
  for (const id of nodeIds) indegree.set(id, 0);
  for (const e of inner) indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);

  const layers: string[][] = [];
  let frontier = nodeIds.filter((id) => (indegree.get(id) ?? 0) === 0);
  const visited = new Set<string>();
  while (frontier.length) {
    layers.push(frontier);
    frontier.forEach((id) => visited.add(id));
    const next = new Map<string, number>(indegree);
    const candidates = new Set<string>();
    for (const e of inner) {
      if (frontier.includes(e.source)) {
        next.set(e.target, (next.get(e.target) ?? 1) - 1);
        candidates.add(e.target);
      }
    }
    indegree.clear();
    next.forEach((v, k) => indegree.set(k, v));
    frontier = [...candidates].filter(
      (id) => !visited.has(id) && (indegree.get(id) ?? 0) <= 0
    );
  }

  let ok = 0;
  let ran = 0;
  for (const layer of layers) {
    const jobs: (() => Promise<boolean>)[] = [];
    for (const id of layer) {
      const node = useCanvasStore.getState().nodes.find((n) => n.id === id);
      if (!node) continue;
      const isCompose =
        node.data.kind === "video" && node.data.providerId === "local";
      const hasIntent = node.data.prompt.trim().length > 0 || isCompose;
      if (!hasIntent) continue; // 纯素材节点直接视为就绪
      jobs.push(() => startGeneration(id));
    }
    const results = await runLimited(jobs);
    ran += results.length;
    ok += results.filter(Boolean).length;
  }
  return [ok, ran];
}

/**
 * 把选中的视频节点合并为一个「视频合成」节点：
 * 按画布位置（上→下、左→右）确定拼接顺序并连线，可附带一条音频做 BGM。
 * 返回新节点 ID。
 */
export function createComposeNode(videoNodeIds: string[], audioNodeId?: string): string | null {
  const store = useCanvasStore.getState();
  const videoNodes = videoNodeIds
    .map((id) => store.nodes.find((n) => n.id === id))
    .filter((n): n is NonNullable<typeof n> => !!n);
  if (videoNodes.length < 2) return null;

  // 拼接顺序 = 画布视觉顺序
  const ordered = [...videoNodes].sort(
    (a, b) => a.position.y - b.position.y || a.position.x - b.position.x
  );
  const right = Math.max(...ordered.map((n) => n.position.x)) + 420;
  const midY =
    ordered.reduce((sum, n) => sum + n.position.y, 0) / ordered.length;

  const cap =
    findCapability("local", "ffmpeg-compose", "compose-video") ??
    defaultCapabilityForKind("video");
  const composeId = store.addNode(
    "video",
    { x: right, y: midY },
    {
      providerId: cap.providerId,
      modelId: cap.modelId,
      params: paramDefaults(cap),
    }
  );
  for (const n of ordered) {
    useCanvasStore.getState().addEdgeBetween(n.id, composeId);
  }
  if (audioNodeId) {
    useCanvasStore.getState().addEdgeBetween(audioNodeId, composeId);
  }
  return composeId;
}
