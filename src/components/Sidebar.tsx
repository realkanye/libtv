"use client";

// 画布左侧栏：添加节点 / 我的资产 / 历史记录 三个面板。

import { useCallback, useEffect, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { useCanvasStore } from "@/lib/store";
import { useAssetStore, type CanvasAsset } from "@/lib/clientAssets";
import { NODE_KIND_META, type NodeKind, type ShotRow } from "@/lib/types";

const KINDS = Object.keys(NODE_KIND_META) as NodeKind[];

interface HistoryItem {
  id: string;
  type: NodeKind;
  url: string | null;
  text: string | null;
  shots: ShotRow[] | null;
  modelId: string;
  createdAt: number;
}

function Thumb({ item }: { item: { type: NodeKind; url?: string | null; text?: string | null } }) {
  if (item.type === "image" && item.url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.url} alt="" className="h-14 w-full rounded object-cover" />;
  }
  if (item.type === "video" && item.url) {
    return <video src={item.url} muted className="h-14 w-full rounded object-cover" />;
  }
  const icon = NODE_KIND_META[item.type]?.icon ?? "📄";
  return (
    <div className="flex h-14 w-full items-center justify-center rounded bg-zinc-800 text-xl">
      {icon}
    </div>
  );
}

export default function Sidebar({
  onUploadClick,
}: {
  onUploadClick: () => void;
}) {
  const [panel, setPanel] = useState<"add" | "assets" | "history" | null>(null);
  const addNode = useCanvasStore((s) => s.addNode);
  const addContentNode = useCanvasStore((s) => s.addContentNode);
  const assets = useAssetStore((s) => s.assets);
  const removeAsset = useAssetStore((s) => s.removeAsset);
  const { screenToFlowPosition } = useReactFlow();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const centerPos = useCallback(
    () =>
      screenToFlowPosition({
        x: window.innerWidth / 2 + (Math.random() - 0.5) * 120,
        y: window.innerHeight / 2 + (Math.random() - 0.5) * 120,
      }),
    [screenToFlowPosition]
  );

  const loadHistory = useCallback(() => {
    setHistoryLoading(true);
    fetch("/api/history")
      .then((r) => r.json())
      .then((d: { items: HistoryItem[] }) => setHistory(d.items))
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }, []);

  useEffect(() => {
    if (panel === "history") loadHistory();
  }, [panel, loadHistory]);

  const sendAssetToCanvas = (a: CanvasAsset) => {
    addContentNode(a.kind, centerPos(), {
      content: a.content,
      shots: a.shots,
      status: a.content || a.shots ? "done" : "idle",
    });
  };

  const sendHistoryToCanvas = (h: HistoryItem) => {
    addContentNode(h.type, centerPos(), {
      content: h.url ?? h.text,
      shots: h.shots,
      status: "done",
    });
  };

  const railBtn = (
    key: "add" | "assets" | "history",
    icon: string,
    label: string
  ) => (
    <button
      key={key}
      title={label}
      onClick={() => setPanel(panel === key ? null : key)}
      className={`flex h-10 w-10 flex-col items-center justify-center rounded-lg text-base ${
        panel === key ? "bg-zinc-700" : "hover:bg-zinc-800"
      }`}
    >
      {icon}
      <span className="text-[8px] text-zinc-400">{label}</span>
    </button>
  );

  return (
    <>
      <div className="absolute left-4 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-1 rounded-xl border border-zinc-800 bg-zinc-900/90 p-2 backdrop-blur">
        {railBtn("add", "➕", "添加")}
        {railBtn("assets", "📦", "资产")}
        {railBtn("history", "🕘", "历史")}
      </div>

      {panel && (
        <div className="absolute left-20 top-1/2 z-40 max-h-[70vh] w-64 -translate-y-1/2 overflow-auto rounded-xl border border-zinc-800 bg-zinc-900/95 p-3 backdrop-blur">
          {panel === "add" && (
            <div>
              <div className="mb-2 text-[11px] text-zinc-500">添加节点</div>
              <div className="grid grid-cols-2 gap-2">
                {KINDS.map((kind) => (
                  <button
                    key={kind}
                    onClick={() => addNode(kind, centerPos())}
                    className="flex items-center gap-2 rounded-lg border border-zinc-800 px-2 py-2 text-xs text-zinc-200 hover:bg-zinc-800"
                  >
                    <span>{NODE_KIND_META[kind].icon}</span>
                    {NODE_KIND_META[kind].label}
                  </button>
                ))}
              </div>
              <div className="mb-2 mt-3 text-[11px] text-zinc-500">添加资源</div>
              <button
                onClick={onUploadClick}
                className="w-full rounded-lg border border-dashed border-zinc-700 px-2 py-3 text-xs text-zinc-400 hover:bg-zinc-800"
              >
                ⬆️ 上传图片 / 视频 / 音频
                <div className="mt-0.5 text-[10px] text-zinc-500">
                  也可以直接拖文件进画布
                </div>
              </button>
            </div>
          )}

          {panel === "assets" && (
            <div>
              <div className="mb-2 text-[11px] text-zinc-500">
                我的资产（节点右键 → 保存为资产）
              </div>
              {assets.length === 0 && (
                <div className="py-6 text-center text-xs text-zinc-600">
                  暂无资产
                </div>
              )}
              <div className="space-y-2">
                {assets.map((a) => (
                  <div
                    key={a.id}
                    className="group rounded-lg border border-zinc-800 p-2"
                  >
                    <Thumb item={{ type: a.kind, url: a.content, text: a.content }} />
                    <div className="mt-1 flex items-center gap-1">
                      <span className="truncate text-[11px] text-zinc-300">
                        {NODE_KIND_META[a.kind].icon} {a.name}
                      </span>
                      <button
                        onClick={() => sendAssetToCanvas(a)}
                        className="ml-auto rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700"
                      >
                        使用
                      </button>
                      <button
                        onClick={() => removeAsset(a.id)}
                        className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-zinc-700"
                      >
                        删
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {panel === "history" && (
            <div>
              <div className="mb-2 flex items-center text-[11px] text-zinc-500">
                生成历史
                <button
                  onClick={loadHistory}
                  className="ml-auto rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-700"
                >
                  刷新
                </button>
              </div>
              {historyLoading && (
                <div className="py-6 text-center text-xs text-zinc-600">
                  加载中…
                </div>
              )}
              {!historyLoading && history.length === 0 && (
                <div className="py-6 text-center text-xs text-zinc-600">
                  暂无生成记录
                </div>
              )}
              <div className="space-y-2">
                {history.map((h) => (
                  <div
                    key={h.id}
                    className="rounded-lg border border-zinc-800 p-2"
                  >
                    <Thumb item={h} />
                    <div className="mt-1 flex items-center gap-1">
                      <span className="truncate text-[10px] text-zinc-500">
                        {h.modelId}
                      </span>
                      <button
                        onClick={() => sendHistoryToCanvas(h)}
                        className="ml-auto rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700"
                      >
                        使用
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
