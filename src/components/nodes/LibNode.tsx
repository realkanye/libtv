"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { LibNode as LibNodeType } from "@/lib/types";
import { NODE_KIND_META } from "@/lib/types";
import { useCanvasStore } from "@/lib/store";

function ContentView({ data }: { data: LibNodeType["data"] }) {
  if (data.status === "generating") {
    return (
      <div className="flex h-32 items-center justify-center text-xs text-zinc-400">
        <span className="animate-pulse">生成中…</span>
      </div>
    );
  }
  if (data.status === "error") {
    return (
      <div className="flex h-20 items-center justify-center text-xs text-red-400">
        生成失败，请重试
      </div>
    );
  }
  if (!data.content && !data.shots) {
    return (
      <div className="flex h-20 items-center justify-center text-xs text-zinc-500">
        输入提示词并点击生成
      </div>
    );
  }
  switch (data.kind) {
    case "text":
      return (
        <div className="max-h-48 overflow-auto whitespace-pre-wrap p-2 text-xs leading-relaxed text-zinc-200">
          {data.content}
        </div>
      );
    case "image":
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.content!}
          alt="生成图片"
          className="w-full rounded-md"
          draggable={false}
        />
      );
    case "video":
      return (
        <video src={data.content!} controls className="w-full rounded-md" />
      );
    case "audio":
      return <audio src={data.content!} controls className="w-full" />;
    case "script":
      return (
        <div className="max-h-56 overflow-auto">
          <table className="w-full text-left text-[11px] text-zinc-300">
            <thead className="sticky top-0 bg-zinc-800 text-zinc-400">
              <tr>
                <th className="p-1.5">场景</th>
                <th className="p-1.5">景别</th>
                <th className="p-1.5">画面描述</th>
                <th className="p-1.5">运镜</th>
              </tr>
            </thead>
            <tbody>
              {data.shots?.map((s) => (
                <tr key={s.id} className="border-t border-zinc-800">
                  <td className="p-1.5 whitespace-nowrap">{s.scene}</td>
                  <td className="p-1.5 whitespace-nowrap">{s.shotType}</td>
                  <td className="p-1.5">{s.description}</td>
                  <td className="p-1.5 whitespace-nowrap">{s.cameraMove}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function LibNodeInner({ id, data, selected }: NodeProps<LibNodeType>) {
  const meta = NODE_KIND_META[data.kind];
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const upstreamContext = useCanvasStore((s) => s.upstreamContext);

  const generate = async () => {
    if (!data.prompt.trim() || data.status === "generating") return;
    updateNodeData(id, { status: "generating" });
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: data.kind,
          prompt: data.prompt,
          model: data.model,
          context: upstreamContext(id),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const out = await res.json();
      updateNodeData(id, {
        content: out.content ?? null,
        shots: out.shots ?? null,
        status: "done",
      });
    } catch {
      updateNodeData(id, { status: "error" });
    }
  };

  return (
    <div
      className={`rounded-xl border bg-zinc-900/95 shadow-lg backdrop-blur transition-shadow ${
        selected ? "shadow-xl" : ""
      } ${data.kind === "script" ? "w-[420px]" : "w-72"}`}
      style={{ borderColor: selected ? meta.accent : "#3f3f46" }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-zinc-900"
        style={{ background: meta.accent }}
      />
      <div
        className="flex items-center gap-2 rounded-t-xl px-3 py-2 text-xs font-medium text-white"
        style={{ background: `${meta.accent}26` }}
      >
        <span>{meta.icon}</span>
        <span>{meta.label}节点</span>
        <span className="ml-auto text-[10px] text-zinc-400">{data.model}</span>
      </div>

      <div className="p-2">
        <ContentView data={data} />
      </div>

      <div className="nodrag border-t border-zinc-800 p-2">
        <textarea
          value={data.prompt}
          onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
          placeholder={
            data.kind === "script"
              ? "描述剧情，生成分镜脚本…"
              : `输入${meta.label}生成提示词…`
          }
          rows={2}
          className="w-full resize-none rounded-md bg-zinc-800 p-2 text-xs text-zinc-200 outline-none placeholder:text-zinc-500 focus:ring-1"
        />
        <div className="mt-1.5 flex items-center gap-2">
          <select
            value={data.model}
            onChange={(e) => updateNodeData(id, { model: e.target.value })}
            className="flex-1 rounded-md bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 outline-none"
          >
            {meta.models.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <button
            onClick={generate}
            disabled={data.status === "generating" || !data.prompt.trim()}
            className="rounded-md px-3 py-1 text-[11px] font-medium text-white transition-opacity disabled:opacity-40"
            style={{ background: meta.accent }}
          >
            {data.status === "generating" ? "生成中" : "生成"}
          </button>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-zinc-900"
        style={{ background: meta.accent }}
      />
    </div>
  );
}

export const LibNodeComponent = memo(LibNodeInner);
