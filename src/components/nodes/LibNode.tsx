"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { LibNode as LibNodeType } from "@/lib/types";
import { NODE_KIND_META } from "@/lib/types";
import { useCanvasStore } from "@/lib/store";
import {
  capabilitiesForKind,
  capabilityKey,
  findCapability,
  resolveMode,
} from "@/lib/providers/catalog";
import { reconcileParams } from "@/lib/providers/params";
import { validateAndNormalize } from "@/lib/providers/validate";
import { useProviderAvailability } from "@/lib/clientProviders";
import type { GenerationParams, ModelCapability } from "@/lib/providers/types";
import type { TaskView } from "@/lib/tasks/types";

const TASK_STATUS_TO_NODE: Record<
  TaskView["status"],
  LibNodeType["data"]["status"]
> = {
  queued: "queued",
  running: "generating",
  succeeded: "done",
  failed: "error",
};

function ContentView({ data }: { data: LibNodeType["data"] }) {
  if (data.status === "queued" || data.status === "generating") {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-2 text-xs text-zinc-400">
        <span className="animate-pulse">
          {data.status === "queued" ? "排队中…" : `生成中… ${data.progress}%`}
        </span>
        {data.status === "generating" && (
          <div className="h-1 w-3/4 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full bg-zinc-400 transition-all"
              style={{ width: `${Math.max(5, data.progress)}%` }}
            />
          </div>
        )}
      </div>
    );
  }
  if (data.status === "error") {
    return (
      <div className="flex min-h-16 items-center justify-center p-2 text-center text-xs text-red-400">
        {data.errorMessage ?? "生成失败，请重试"}
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
      return <video src={data.content!} controls className="w-full rounded-md" />;
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

/** 能力声明驱动的参数控件：模型没声明的参数不会出现。 */
function ParamControls({
  cap,
  params,
  onChange,
}: {
  cap: ModelCapability;
  params: GenerationParams;
  onChange: (patch: Partial<GenerationParams>) => void;
}) {
  const p = cap.params;
  if (!p.aspectRatio && !p.duration && !p.count && !p.resolution) return null;
  const cls =
    "rounded-md bg-zinc-800 px-1.5 py-1 text-[10px] text-zinc-300 outline-none";
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {p.aspectRatio && (
        <select
          className={cls}
          value={params.aspectRatio}
          onChange={(e) => onChange({ aspectRatio: e.target.value })}
          title="画幅比"
        >
          {p.aspectRatio.options.map((o) => (
            <option key={o} value={o}>
              ⬚ {o}
            </option>
          ))}
        </select>
      )}
      {p.duration && (
        <select
          className={cls}
          value={params.duration}
          onChange={(e) => onChange({ duration: Number(e.target.value) })}
          title="时长"
        >
          {p.duration.options.map((o) => (
            <option key={o} value={o}>
              ⏱ {o}s
            </option>
          ))}
        </select>
      )}
      {p.count && (
        <select
          className={cls}
          value={params.count}
          onChange={(e) => onChange({ count: Number(e.target.value) })}
          title="出图张数"
        >
          {p.count.options.map((o) => (
            <option key={o} value={o}>
              ✦ {o} 张
            </option>
          ))}
        </select>
      )}
      {p.resolution && (
        <select
          className={cls}
          value={params.resolution}
          onChange={(e) => onChange({ resolution: e.target.value })}
          title="分辨率"
        >
          {p.resolution.options.map((o) => (
            <option key={o} value={o}>
              ◳ {o}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function LibNodeInner({ id, data, selected }: NodeProps<LibNodeType>) {
  const meta = NODE_KIND_META[data.kind];
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const upstreamInputs = useCanvasStore((s) => s.upstreamInputs);
  const edges = useCanvasStore((s) => s.edges);
  const nodes = useCanvasStore((s) => s.nodes);
  const availability = useProviderAvailability((s) => s.availability);
  const ensureLoaded = useProviderAvailability((s) => s.ensureLoaded);

  const esRef = useRef<EventSource | null>(null);

  useEffect(() => ensureLoaded(), [ensureLoaded]);

  const caps = capabilitiesForKind(data.kind);
  const cap = findCapability(data.providerId, data.modelId) ?? caps[0];

  // 连线语义：上游图片数量决定生成模式（文生 / 图生 / 首尾帧）。
  const inputs = useMemo(
    () => upstreamInputs(id),
    // edges/nodes 变化时重算，保证连线即时反映
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, edges, nodes, upstreamInputs]
  );
  const mode = resolveMode(data.kind, inputs.images.length);

  // 用同一套校验逻辑做实时连线/参数校验（与服务端一致，单一真相源）。
  const validation = useMemo(
    () =>
      validateAndNormalize({
        providerId: data.providerId,
        modelId: data.modelId,
        mode,
        prompt: data.prompt,
        images: inputs.images,
        refTexts: inputs.refTexts,
        params: data.params,
      }),
    [data.providerId, data.modelId, mode, data.prompt, data.params, inputs]
  );

  const busy = data.status === "queued" || data.status === "generating";
  const canGenerate = validation.ok && !busy;
  // 仅当问题不是「提示词为空」时才提示，避免一进来就报错。
  const hint =
    !validation.ok && validation.message !== "请输入提示词"
      ? validation.message
      : null;

  const closeStream = () => {
    esRef.current?.close();
    esRef.current = null;
  };

  const applyView = (view: TaskView) => {
    const patch: Partial<LibNodeType["data"]> = {
      status: TASK_STATUS_TO_NODE[view.status],
      progress: view.progress,
    };
    if (view.status === "succeeded") {
      const out = view.outputs[0];
      if (out) {
        patch.content = out.url ?? out.text ?? null;
        patch.shots = out.shots ?? null;
      }
      closeStream();
    } else if (view.status === "failed") {
      patch.errorMessage = view.error?.message ?? "生成失败";
      closeStream();
    }
    updateNodeData(id, patch);
  };

  const subscribe = (taskId: string) => {
    closeStream();
    const es = new EventSource(`/api/tasks/${taskId}/stream`);
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        applyView(JSON.parse(ev.data) as TaskView);
      } catch {
        /* 忽略心跳/解析异常 */
      }
    };
    es.addEventListener("notfound", () => {
      updateNodeData(id, { status: "error", errorMessage: "任务不存在或已过期" });
      closeStream();
    });
  };

  const generate = async () => {
    if (!canGenerate) return;
    updateNodeData(id, { status: "queued", progress: 0, errorMessage: null });
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId: id,
          providerId: data.providerId,
          modelId: data.modelId,
          mode,
          prompt: data.prompt,
          images: inputs.images,
          refTexts: inputs.refTexts,
          params: data.params,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        updateNodeData(id, {
          status: "error",
          errorMessage: body.error ?? `请求失败（${res.status}）`,
        });
        return;
      }
      updateNodeData(id, { taskId: body.taskId });
      subscribe(body.taskId);
    } catch {
      updateNodeData(id, { status: "error", errorMessage: "网络错误，请重试" });
    }
  };

  // 刷新 / 重连恢复：若存在进行中的任务则重新订阅。组件卸载时关闭连接。
  useEffect(() => {
    if (data.taskId && (data.status === "queued" || data.status === "generating")) {
      subscribe(data.taskId);
    }
    return () => closeStream();
    // 仅在挂载时尝试恢复
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onModelChange = (key: string) => {
    const next = caps.find((c) => capabilityKey(c) === key);
    if (!next) return;
    updateNodeData(id, {
      providerId: next.providerId,
      modelId: next.modelId,
      params: reconcileParams(next, data.params),
    });
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
        <span className="ml-auto text-[10px] text-zinc-400">{cap.label}</span>
      </div>

      <div className="p-2">
        <ContentView data={data} />
        {data.status === "error" && (
          <button
            onClick={generate}
            disabled={!validation.ok}
            className="mt-1 w-full rounded-md border border-zinc-700 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
          >
            重试
          </button>
        )}
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

        <ParamControls
          cap={cap}
          params={data.params}
          onChange={(patch) =>
            updateNodeData(id, { params: { ...data.params, ...patch } })
          }
        />

        {hint && (
          <div className="mt-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-[10px] text-amber-400">
            {hint}
          </div>
        )}

        <div className="mt-1.5 flex items-center gap-2">
          <select
            value={capabilityKey(cap)}
            onChange={(e) => onModelChange(e.target.value)}
            className="flex-1 rounded-md bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 outline-none"
          >
            {caps.map((c) => {
              const configured =
                c.providerId === "mock" || availability[c.providerId];
              const unavailable = availability[c.providerId] === false;
              return (
                <option
                  key={capabilityKey(c)}
                  value={capabilityKey(c)}
                  disabled={unavailable}
                >
                  {c.label}
                  {unavailable ? "（未配置）" : configured ? "" : ""}
                </option>
              );
            })}
          </select>
          <button
            onClick={generate}
            disabled={!canGenerate}
            className="rounded-md px-3 py-1 text-[11px] font-medium text-white transition-opacity disabled:opacity-40"
            style={{ background: meta.accent }}
          >
            {busy ? "生成中" : "生成"}
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
