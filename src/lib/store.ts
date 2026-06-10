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
import { NODE_KIND_META } from "./types";

let nodeSeq = 0;

interface CanvasState {
  nodes: LibNode[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange<LibNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (kind: NodeKind, position: { x: number; y: number }) => void;
  updateNodeData: (id: string, patch: Partial<LibNodeData>) => void;
  /** 收集上游已完成节点的内容，作为生成时的参考输入 */
  upstreamContext: (id: string) => string[];
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

  addNode: (kind, position) =>
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
            model: NODE_KIND_META[kind].models[0],
            content: null,
            shots: null,
            status: "idle",
          },
        },
      ],
    }),

  updateNodeData: (id, patch) =>
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...patch } } : n
      ),
    }),

  upstreamContext: (id) => {
    const { nodes, edges } = get();
    return edges
      .filter((e) => e.target === id)
      .map((e) => nodes.find((n) => n.id === e.source))
      .filter((n): n is LibNode => !!n && n.data.status === "done")
      .map((n) =>
        n.data.kind === "text"
          ? `[文本参考] ${n.data.content}`
          : `[${NODE_KIND_META[n.data.kind].label}参考] ${n.data.content}`
      );
  },
}));
