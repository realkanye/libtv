import { create } from "zustand";
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

/** 上游已完成节点拆解出的生成输入。 */
export interface UpstreamInputs {
  /** 图片节点产物 URL，顺序即连接顺序（首帧在前、尾帧在后）。 */
  images: string[];
  /** 文本/分镜节点正文，作为提示词增强。 */
  refTexts: string[];
}

interface CanvasState {
  nodes: LibNode[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange<LibNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (kind: NodeKind, position: { x: number; y: number }) => void;
  updateNodeData: (id: string, patch: Partial<LibNodeData>) => void;
  /** 收集上游已完成节点的内容（区分图片参考与文本参考）。 */
  upstreamInputs: (id: string) => UpstreamInputs;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  edges: [],

  onNodesChange: (changes) =>
    set({ nodes: applyNodeChanges(changes, get().nodes) }),

  onEdgesChange: (changes) =>
    set({ edges: applyEdgeChanges(changes, get().edges) }),

  onConnect: (connection) =>
    set({ edges: addEdge({ ...connection, animated: true }, get().edges) }),

  addNode: (kind, position) => {
    const cap = defaultCapabilityForKind(kind);
    set({
      nodes: [
        ...get().nodes,
        {
          id: `${kind}-${++nodeSeq}-${Date.now()}`,
          type: kind,
          position,
          data: {
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
          },
        },
      ],
    });
  },

  updateNodeData: (id, patch) =>
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...patch } } : n
      ),
    }),

  upstreamInputs: (id) => {
    const { nodes, edges } = get();
    const sources = edges
      .filter((e) => e.target === id)
      .map((e) => nodes.find((n) => n.id === e.source))
      .filter((n): n is LibNode => !!n && n.data.status === "done");

    const images: string[] = [];
    const refTexts: string[] = [];
    for (const n of sources) {
      const { kind, content } = n.data;
      if (!content) continue;
      if (kind === "image") images.push(content);
      else if (kind === "text" || kind === "script") refTexts.push(content);
    }
    return { images, refTexts };
  },
}));
