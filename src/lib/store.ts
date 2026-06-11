import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from "@xyflow/react";
import type { LibNode, LibNodeData, NodeKind } from "./types";
import { defaultCapabilityForKind } from "./providers/catalog";
import { paramDefaults } from "./providers/params";

let nodeSeq = 0;

function newNodeId(kind: NodeKind): string {
  return `${kind}-${++nodeSeq}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function defaultData(kind: NodeKind): LibNodeData {
  const cap = defaultCapabilityForKind(kind);
  return {
    kind,
    prompt: "",
    providerId: cap.providerId,
    modelId: cap.modelId,
    params: paramDefaults(cap),
    content: null,
    shots: null,
    status: "idle",
    progress: 0,
    errorMessage: null,
    taskId: null,
  };
}

/** 上游已完成节点拆解出的生成输入。 */
export interface UpstreamInputs {
  /** 图片节点产物 URL，顺序即连接顺序（首帧在前、尾帧在后）。 */
  images: string[];
  /** 视频节点产物 URL（视频合成按此顺序拼接）。 */
  videos: string[];
  /** 音频节点产物 URL（合成时作为 BGM）。 */
  audios: string[];
  /** 文本/分镜节点正文，作为提示词增强。 */
  refTexts: string[];
}

/** 单节点剪贴板（复制粘贴不保留连线；模块级即可，无需持久化）。 */
let clipboard: { kind: NodeKind; data: LibNodeData } | null = null;

interface CanvasState {
  nodes: LibNode[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange<LibNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  /** 新建空节点，返回节点 ID。 */
  addNode: (
    kind: NodeKind,
    position: { x: number; y: number },
    init?: Partial<LibNodeData>
  ) => string;
  /** 新建已有内容的节点（上传文件 / 历史 / 资产发送到画布）。 */
  addContentNode: (
    kind: NodeKind,
    position: { x: number; y: number },
    content: Partial<LibNodeData>
  ) => string;
  updateNodeData: (id: string, patch: Partial<LibNodeData>) => void;
  removeNodes: (ids: string[]) => void;
  /** 副本：克隆节点并保留全部进出连线。 */
  duplicateNode: (id: string) => string | null;
  /** 复制到剪贴板（不带连线）。 */
  copyNode: (id: string) => boolean;
  /** 从剪贴板粘贴，返回新节点 ID。 */
  pasteNode: (position: { x: number; y: number }) => string | null;
  hasClipboard: () => boolean;
  /** 直接连线（流水线/合成节点用）。 */
  addEdgeBetween: (source: string, target: string) => void;
  /** 收集上游已完成节点的内容（按类型分组，保持连接顺序）。 */
  upstreamInputs: (id: string) => UpstreamInputs;
}

export const useCanvasStore = create<CanvasState>()(
  persist(
    (set, get) => ({
      nodes: [],
      edges: [],

      onNodesChange: (changes) =>
        set({ nodes: applyNodeChanges(changes, get().nodes) }),

      onEdgesChange: (changes) =>
        set({ edges: applyEdgeChanges(changes, get().edges) }),

      onConnect: (connection) =>
        set({ edges: addEdge({ ...connection, animated: true }, get().edges) }),

      addNode: (kind, position, init) => {
        const id = newNodeId(kind);
        set({
          nodes: [
            ...get().nodes,
            { id, type: kind, position, data: { ...defaultData(kind), ...init } },
          ],
        });
        return id;
      },

      addContentNode: (kind, position, content) => {
        const id = newNodeId(kind);
        set({
          nodes: [
            ...get().nodes,
            {
              id,
              type: kind,
              position,
              data: { ...defaultData(kind), status: "done", ...content },
            },
          ],
        });
        return id;
      },

      updateNodeData: (id, patch) =>
        set({
          nodes: get().nodes.map((n) =>
            n.id === id ? { ...n, data: { ...n.data, ...patch } } : n
          ),
        }),

      removeNodes: (ids) => {
        const idSet = new Set(ids);
        set({
          nodes: get().nodes.filter((n) => !idSet.has(n.id)),
          edges: get().edges.filter(
            (e) => !idSet.has(e.source) && !idSet.has(e.target)
          ),
        });
      },

      duplicateNode: (id) => {
        const node = get().nodes.find((n) => n.id === id);
        if (!node) return null;
        const newId = newNodeId(node.data.kind);
        const clonedEdges = get()
          .edges.filter((e) => e.source === id || e.target === id)
          .map((e, i) => ({
            ...e,
            id: `${newId}-edge-${i}`,
            source: e.source === id ? newId : e.source,
            target: e.target === id ? newId : e.target,
          }));
        set({
          nodes: [
            ...get().nodes,
            {
              ...node,
              id: newId,
              position: { x: node.position.x + 48, y: node.position.y + 48 },
              selected: false,
              data: { ...node.data, taskId: null },
            },
          ],
          edges: [...get().edges, ...clonedEdges],
        });
        return newId;
      },

      copyNode: (id) => {
        const node = get().nodes.find((n) => n.id === id);
        if (!node) return false;
        clipboard = { kind: node.data.kind, data: { ...node.data, taskId: null } };
        return true;
      },

      pasteNode: (position) => {
        if (!clipboard) return null;
        const id = newNodeId(clipboard.kind);
        set({
          nodes: [
            ...get().nodes,
            {
              id,
              type: clipboard.kind,
              position,
              data: { ...clipboard.data },
            },
          ],
        });
        return id;
      },

      hasClipboard: () => clipboard !== null,

      addEdgeBetween: (source, target) => {
        const exists = get().edges.some(
          (e) => e.source === source && e.target === target
        );
        if (exists) return;
        set({
          edges: [
            ...get().edges,
            {
              id: `e-${source}-${target}`,
              source,
              target,
              animated: true,
            },
          ],
        });
      },

      upstreamInputs: (id) => {
        const { nodes, edges } = get();
        const sources = edges
          .filter((e) => e.target === id)
          .map((e) => nodes.find((n) => n.id === e.source))
          .filter((n): n is LibNode => !!n && n.data.status === "done");

        const inputs: UpstreamInputs = {
          images: [],
          videos: [],
          audios: [],
          refTexts: [],
        };
        for (const n of sources) {
          const { kind, content } = n.data;
          if (!content) continue;
          if (kind === "image") inputs.images.push(content);
          else if (kind === "video") inputs.videos.push(content);
          else if (kind === "audio") inputs.audios.push(content);
          else inputs.refTexts.push(content);
        }
        return inputs;
      },
    }),
    {
      name: "libtv-canvas-v1",
      // SSR 下跳过自动注水，由 Canvas 挂载后手动 rehydrate（避免 hydration mismatch）
      skipHydration: true,
      partialize: (s) => ({
        nodes: s.nodes.map((n) => ({
          ...n,
          selected: false,
          dragging: false,
        })),
        edges: s.edges,
      }),
    }
  )
);
