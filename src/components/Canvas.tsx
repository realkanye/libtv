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
import { resumeActiveTasks, releaseNodeStreams } from "@/lib/taskClient";
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
  | {
      type: "pane";
      screen: { x: number; y: number };
      flow: { x: number; y: number };
      /** 由「拉线建节点」触发时，新建节点自动连接的源节点。 */
      connectFrom?: string;
    }
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
    "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs text-zinc-200 transition-colors hover:bg-white/5";

  const node =
    menu.type === "node"
      ? store.getState().nodes.find((n) => n.id === menu.nodeId)
      : undefined;

  return (
    <div
      className="lib-glass lib-fade-in absolute z-50 w-48 overflow-hidden rounded-xl border border-[var(--border)] p-1 shadow-[0_16px_48px_rgba(0,0,0,0.6)]"
      style={{ left: menu.screen.x, top: menu.screen.y }}
      onMouseLeave={onClose}
    >
      {menu.type === "pane" && (
        <>
          <div className="px-3 py-1 text-[10px] text-zinc-500">
            {menu.connectFrom ? "拉线新建并连接" : "添加节点"}
          </div>
          {KINDS.map((kind) => (
            <button
              key={kind}
              className={itemCls}
              onClick={() => {
                const id = store.getState().addNode(kind, menu.flow);
                if (menu.connectFrom) {
                  store.getState().addEdgeBetween(menu.connectFrom, id);
                }
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
              releaseNodeStreams([node.data.taskId]);
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
    <div className="lib-glass lib-fade-in absolute left-1/2 top-16 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--border)] px-4 py-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.45)]">
      <span className="text-[11px] text-zinc-400">
        已选 <span className="font-semibold text-zinc-200">{selected.length}</span> 个节点
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
  const connectingFrom = useRef<string | null>(null);

  // 拉线建节点：记录起点节点；松手落在空白处则弹出选择器并自动连接
  const onConnectStart = useCallback(
    (_: unknown, params: { nodeId: string | null }) => {
      connectingFrom.current = params.nodeId;
    },
    []
  );
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const from = connectingFrom.current;
      connectingFrom.current = null;
      if (!from) return;
      const target = event.target as HTMLElement | null;
      // 落在画布空白（pane）才新建；落在已有节点/handle 则视为正常连线
      if (!target?.classList.contains("react-flow__pane")) return;
      const point =
        "clientX" in event
          ? { x: event.clientX, y: event.clientY }
          : { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
      setMenu({
        type: "pane",
        screen: point,
        flow: screenToFlowPosition(point),
        connectFrom: from,
      });
    },
    [screenToFlowPosition]
  );

  // localStorage 注水（SSR 安全），注水完成后再恢复刷新前进行中的任务
  useEffect(() => {
    let active = true;
    (async () => {
      await useCanvasStore.persist.rehydrate();
      if (!active) return;
      setHydrated(true);
      resumeActiveTasks();
    })();
    return () => {
      active = false;
    };
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
      const key = e.key.toLowerCase();
      if (key === "z") {
        // Cmd/Ctrl+Z 撤销；+Shift 或 Ctrl+Y 重做
        e.preventDefault();
        if (e.shiftKey) state.redo();
        else state.undo();
      } else if (key === "y") {
        e.preventDefault();
        state.redo();
      } else if (key === "c") {
        const sel = state.nodes.find((n) => n.selected);
        if (sel) state.copyNode(sel.id);
      } else if (key === "v") {
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
      <div className="flex h-full flex-col items-center justify-center gap-3 text-xs text-zinc-600">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-violet-500" />
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
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onNodeDragStart={() => useCanvasStore.getState().commitHistory()}
        onNodesDelete={(deleted) =>
          releaseNodeStreams(deleted.map((n) => n.data.taskId))
        }
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={() => setMenu(null)}
        onMoveStart={() => setMenu(null)}
        zoomOnDoubleClick={false}
        minZoom={0.1}
        fitView
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
        defaultEdgeOptions={{ animated: true }}
        deleteKeyCode={["Delete", "Backspace"]}
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1.4} color="#2a2a32" />
        <MiniMap
          pannable
          zoomable
          position="bottom-left"
          nodeColor={(n) =>
            NODE_KIND_META[(n.data as { kind: NodeKind }).kind]?.accent ?? "#52525b"
          }
          nodeStrokeWidth={0}
          maskColor="rgba(9,9,11,0.7)"
        />
        <Controls position="bottom-right" showInteractive={false} />
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
        <div className="lib-fade-in absolute bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-red-500/40 bg-red-950/90 px-4 py-2 text-xs text-red-200 shadow-lg backdrop-blur">
          {uploadError}
        </div>
      )}

      <div className="lib-glass pointer-events-none absolute left-1/2 top-4 z-40 -translate-x-1/2 rounded-full border border-[var(--border)] px-4 py-1.5 text-[11px] text-zinc-400 shadow-lg">
        双击空白建节点 · 拖文件上传 · 拉线建节点 · 右键更多 · 框选可整组执行/合成 ·{" "}
        <span className="text-zinc-500">⌘Z 撤销</span>
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
