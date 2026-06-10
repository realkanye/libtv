"use client";

import { useCallback, useState } from "react";
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
import { NODE_KIND_META, type NodeKind } from "@/lib/types";
import { LibNodeComponent } from "./nodes/LibNode";

const nodeTypes = {
  text: LibNodeComponent,
  image: LibNodeComponent,
  video: LibNodeComponent,
  audio: LibNodeComponent,
  script: LibNodeComponent,
};

const KINDS = Object.keys(NODE_KIND_META) as NodeKind[];

function NodePicker({
  at,
  onPick,
  onClose,
}: {
  at: { x: number; y: number };
  onPick: (kind: NodeKind) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="absolute z-50 w-36 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
      style={{ left: at.x, top: at.y }}
      onMouseLeave={onClose}
    >
      <div className="px-3 py-1.5 text-[10px] text-zinc-500">添加节点</div>
      {KINDS.map((kind) => (
        <button
          key={kind}
          onClick={() => onPick(kind)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800"
        >
          <span>{NODE_KIND_META[kind].icon}</span>
          {NODE_KIND_META[kind].label}节点
        </button>
      ))}
    </div>
  );
}

function Toolbar() {
  const addNode = useCanvasStore((s) => s.addNode);
  const { screenToFlowPosition } = useReactFlow();

  const addAtCenter = (kind: NodeKind) => {
    const pos = screenToFlowPosition({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 120,
      y: window.innerHeight / 2 + (Math.random() - 0.5) * 120,
    });
    addNode(kind, pos);
  };

  return (
    <div className="absolute left-4 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-1 rounded-xl border border-zinc-800 bg-zinc-900/90 p-2 backdrop-blur">
      <div className="px-1 pb-1 text-[10px] text-zinc-500">添加</div>
      {KINDS.map((kind) => (
        <button
          key={kind}
          title={`新建${NODE_KIND_META[kind].label}节点`}
          onClick={() => addAtCenter(kind)}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-lg hover:bg-zinc-800"
        >
          {NODE_KIND_META[kind].icon}
        </button>
      ))}
    </div>
  );
}

function CanvasInner() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, addNode } =
    useCanvasStore();
  const { screenToFlowPosition } = useReactFlow();
  const [picker, setPicker] = useState<{
    screen: { x: number; y: number };
    flow: { x: number; y: number };
  } | null>(null);

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!(e.target as HTMLElement).classList.contains("react-flow__pane"))
        return;
      setPicker({
        screen: { x: e.clientX, y: e.clientY },
        flow: screenToFlowPosition({ x: e.clientX, y: e.clientY }),
      });
    },
    [screenToFlowPosition]
  );

  return (
    <div className="h-full w-full" onDoubleClick={onDoubleClick}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
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
      <Toolbar />
      {picker && (
        <NodePicker
          at={picker.screen}
          onPick={(kind) => {
            addNode(kind, picker.flow);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
      <div className="pointer-events-none absolute left-1/2 top-4 z-40 -translate-x-1/2 rounded-full border border-zinc-800 bg-zinc-900/80 px-4 py-1.5 text-xs text-zinc-400 backdrop-blur">
        双击画布空白处新建节点 · 拖拽节点两侧圆点连线搭建工作流
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
