"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  Controls,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCanvasStore } from "@/lib/store";
import { useAssetStore } from "@/lib/clientAssets";
import { resumeActiveTasks } from "@/lib/taskClient";
import { runGroup, createComposeNode } from "@/lib/pipeline";
import { NODE_KIND_META, type LibNode, type NodeKind } from "@/lib/types";
import { LibNodeComponent } from "./nodes/LibNode";
import Sidebar from "./Sidebar";

const nodeTypes = {
  text: LibNodeComponent,
  image: LibNodeComponent,
  video: LibNodeComponent,
  audio: LibNodeComponent,
  script: LibNodeComponent,
};

const KINDS = Object.keys(NODE_KIND_META) as NodeKind[];

type MenuState =
  | { type: "pane"; screen: { x: number; y: number }; flow: { x: number; y: number } }
  | { type: "node"; screen: { x: number; y: number }; nodeId: string };

async function uploadFile(file: File): Promise<{ url: string; kind: NodeKind } | { error: string }> {
  const form = new FormData();
  form.append("file", file);
  try {
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const body = await res.json();
    if (!res.ok) return { error: body.error ?? "上传失败" };
    return body as { url: string; kind: NodeKind };
  } catch {
    return { error: "网络错误，上传失败" };
  }
}

function ContextMenu({
  menu,
  onClose,
}: {
  menu: MenuState;
  onClose: () => void;
}) {
  const store = useCanvasStore;
  const addAsset = useAssetStore((s) => s.addAsset);

  const itemCls =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800";

  const node =
    menu.type === "node"
      ? store.getState().nodes.find((n) => n.id === menu.nodeId)
      : undefined;

  return (
    <div
      className="absolute z-50 w-44 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-2xl"
      style={{ left: menu.screen.x, top: menu.screen.y }}
      onMouseLeave={onClose}
    >
      {menu.type === "pane" && (
        <>
          <div className="px-3 py-1 text-[10px] text-zinc-500">添加节点</div>
          {KINDS.map((kind) => (
            <button
              key={kind}
              className={itemCls}
              onClick={() => {
                store.getState().addNode(kind, menu.flow);
                onClose();
              }}
            >
              <span>{NODE_KIND_META[kind].icon}</span>
              {NODE_KIND_META[kind].label}节点
            </button>
          ))}
          <div className="my-1 border-t border-zinc-800" />
          {store.getState().hasClipboard() && (
            <button
              className={itemCls}
              onClick={() => {
                store.getState().pasteNode(menu.flow);
                onClose();
              }}
            >
              📋 粘贴
            </button>
          )}
        </>
      )}
      {menu.type === "node" && node && (
        <>
          <button
            className={itemCls}
            onClick={() => {
              store.getState().duplicateNode(menu.nodeId);
              onClose();
            }}
          >
            🧬 创建副本（带连线）
          </button>
          <button
            className={itemCls}
            onClick={() => {
              store.getState().copyNode(menu.nodeId);
              onClose();
            }}
          >
            📄 复制（Ctrl+C）
          </button>
          {(node.data.content || node.data.shots) && (
            <button
              className={itemCls}
              onClick={() => {
                const name =
                  node.data.prompt.trim().slice(0, 20) ||
                  `${NODE_KIND_META[node.data.kind].label}资产`;
                addAsset({
                  name,
                  kind: node.data.kind,
                  content: node.data.content,
                  shots: node.data.shots,
                });
                onClose();
              }}
            >
              📦 保存为资产
            </button>
          )}
          <div className="my-1 border-t border-zinc-800" />
          <button
            className={`${itemCls} !text-red-400`}
            onClick={() => {
              store.getState().removeNodes([menu.nodeId]);
              onClose();
            }}
          >
            🗑️ 删除（Delete）
          </button>
        </>
      )}
      {menu.type === "node" && !node && (
        <div className="px-3 py-2 text-xs text-zinc-500">节点已删除</div>
      )}
    </div>
  );
}

/** 选中 ≥2 节点时浮出的批量操作条。 */
function SelectionToolbar() {
  const nodes = useCanvasStore((s) => s.nodes);
  const [groupBusy, setGroupBusy] = useState(false);
  const selected = nodes.filter((n) => n.selected);
  if (selected.length < 2) return null;

  const selectedVideos = selected.filter(
    (n) => n.data.kind === "video" && n.data.status === "done" && n.data.content
  );
  const selectedAudio = selected.find(
    (n) => n.data.kind === "audio" && n.data.status === "done" && n.data.content
  );

  const exec = async () => {
    if (groupBusy) return;
    setGroupBusy(true);
    try {
      await runGroup(selected.map((n) => n.id));
    } finally {
      setGroupBusy(false);
    }
  };

  return (
    <div className="absolute left-1/2 top-16 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/95 px-4 py-1.5 backdrop-blur">
      <span className="text-[11px] text-zinc-400">
        已选 {selected.length} 个节点
      </span>
      <button
        onClick={() => void exec()}
        disabled={groupBusy}
        className="rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
      >
        {groupBusy ? "执行中…" : "▶ 整组执行"}
      </button>
      {selectedVideos.length >= 2 && (
        <button
          onClick={() =>
            createComposeNode(
              selectedVideos.map((n) => n.id),
              selectedAudio?.id
            )
          }
          className="rounded-full bg-amber-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-amber-500"
        >
          🎬 视频合成{selectedAudio ? "（含BGM）" : ""}
        </button>
      )}
    </div>
  );
}

function CanvasInner() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect } =
    useCanvasStore();
  const { screenToFlowPosition } = useReactFlow();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastPointer = useRef({ x: 0, y: 0 });

  // localStorage 注水（SSR 安全），随后恢复刷新前进行中的任务
  useEffect(() => {
    void useCanvasStore.persist.rehydrate();
    setHydrated(true);
    // 注水是同步的（localStorage），下一帧恢复任务
    requestAnimationFrame(() => resumeActiveTasks());
  }, []);

  const flashError = (msg: string) => {
    setUploadError(msg);
    setTimeout(() => setUploadError(null), 4000);
  };

  const handleFiles = useCallback(
    async (files: FileList | File[], at?: { x: number; y: number }) => {
      const list = [...files];
      const basePos =
        at ??
        screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        });
      for (let i = 0; i < list.length; i++) {
        const result = await uploadFile(list[i]);
        if ("error" in result) {
          flashError(result.error);
          continue;
        }
        useCanvasStore.getState().addContentNode(
          result.kind,
          { x: basePos.x + i * 60, y: basePos.y + i * 60 },
          { content: result.url }
        );
      }
    },
    [screenToFlowPosition]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      void handleFiles(e.dataTransfer.files, flow);
    },
    [handleFiles, screenToFlowPosition]
  );

  // 双击空白处快速建节点（保留 Phase 0 交互）
  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!(e.target as HTMLElement).classList.contains("react-flow__pane"))
        return;
      setMenu({
        type: "pane",
        screen: { x: e.clientX, y: e.clientY },
        flow: screenToFlowPosition({ x: e.clientX, y: e.clientY }),
      });
    },
    [screenToFlowPosition]
  );

  const onPaneContextMenu = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      e.preventDefault();
      setMenu({
        type: "pane",
        screen: { x: e.clientX, y: e.clientY },
        flow: screenToFlowPosition({ x: e.clientX, y: e.clientY }),
      });
    },
    [screenToFlowPosition]
  );

  const onNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: LibNode) => {
      e.preventDefault();
      setMenu({
        type: "node",
        screen: { x: e.clientX, y: e.clientY },
        nodeId: node.id,
      });
    },
    []
  );

  // Ctrl/Cmd+C / V：复制选中节点（不带连线）→ 粘贴到鼠标位置
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "TEXTAREA" ||
        target.tagName === "INPUT" ||
        target.isContentEditable
      )
        return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const state = useCanvasStore.getState();
      if (e.key === "c") {
        const sel = state.nodes.find((n) => n.selected);
        if (sel) state.copyNode(sel.id);
      } else if (e.key === "v") {
        if (state.hasClipboard()) {
          state.pasteNode(
            screenToFlowPosition({
              x: lastPointer.current.x || window.innerWidth / 2,
              y: lastPointer.current.y || window.innerHeight / 2,
            })
          );
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screenToFlowPosition]);

  if (!hydrated) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-zinc-600">
        加载画布…
      </div>
    );
  }

  return (
    <div
      className="h-full w-full"
      onDoubleClick={onDoubleClick}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
      onMouseMove={(e) => {
        lastPointer.current = { x: e.clientX, y: e.clientY };
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={() => setMenu(null)}
        zoomOnDoubleClick={false}
        minZoom={0.1}
        fitView
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
        deleteKeyCode={["Delete", "Backspace"]}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} />
        <MiniMap pannable zoomable position="bottom-left" />
        <Controls position="bottom-right" />
      </ReactFlow>

      <Sidebar onUploadClick={() => fileInputRef.current?.click()} />
      <SelectionToolbar />
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {uploadError && (
        <div className="absolute bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-red-800 bg-red-950/90 px-4 py-2 text-xs text-red-300">
          {uploadError}
        </div>
      )}

      <div className="pointer-events-none absolute left-1/2 top-4 z-40 -translate-x-1/2 rounded-full border border-zinc-800 bg-zinc-900/80 px-4 py-1.5 text-xs text-zinc-400 backdrop-blur">
        双击空白处建节点 · 拖文件入画布上传 · 右键更多操作 · 框选多节点可整组执行/合成
      </div>
    </div>
  );
}

export default function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
