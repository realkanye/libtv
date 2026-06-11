"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { LibNode as LibNodeType, ShotRow } from "@/lib/types";
import { NODE_KIND_META } from "@/lib/types";
import { useCanvasStore } from "@/lib/store";
import {
  capabilitiesForKind,
  capabilityKey,
  findCapability,
  resolveMode,
  toolsForKind,
} from "@/lib/providers/catalog";
import { reconcileParams } from "@/lib/providers/params";
import { validateAndNormalize } from "@/lib/providers/validate";
import { useProviderAvailability } from "@/lib/clientProviders";
import {
  startGeneration,
  retryGeneration,
  startToolGeneration,
} from "@/lib/taskClient";
import { generateShotImages, generateShotVideos } from "@/lib/pipeline";
import { SLASH_PRESETS } from "@/lib/slashPresets";
import type {
  EditParams,
  GenerationParams,
  ModelCapability,
} from "@/lib/providers/types";

function Spinner({ data }: { data: LibNodeType["data"] }) {
  return (
    <div className="flex h-32 flex-col items-center justify-center gap-2 text-xs text-zinc-400">
      <span className="animate-pulse">
        {data.status === "queued" ? "排队中…" : `生成中… ${data.progress}%`}
      </span>
      {data.status === "generating" && (
        <div className="h-1.5 w-3/4 overflow-hidden rounded-full bg-black/40">
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-400 transition-all duration-300"
            style={{ width: `${Math.max(5, data.progress)}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** 脚本分镜表：单元格可编辑 + 行勾选（供批量生成）。 */
function ShotTable({
  nodeId,
  shots,
  selected,
  onToggle,
}: {
  nodeId: string;
  shots: ShotRow[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const updateShot = (shotId: string, patch: Partial<ShotRow>) => {
    updateNodeData(nodeId, {
      shots: shots.map((s) => (s.id === shotId ? { ...s, ...patch } : s)),
    });
  };
  const cellCls =
    "w-full bg-transparent outline-none focus:bg-zinc-800 rounded px-1 py-0.5";
  return (
    <div className="max-h-64 overflow-auto">
      <table className="w-full text-left text-[11px] text-zinc-300">
        <thead className="sticky top-0 bg-zinc-800 text-zinc-400">
          <tr>
            <th className="w-6 p-1.5"></th>
            <th className="p-1.5">场景</th>
            <th className="p-1.5">景别</th>
            <th className="w-1/2 p-1.5">画面描述</th>
            <th className="p-1.5">运镜</th>
          </tr>
        </thead>
        <tbody>
          {shots.map((s) => (
            <tr key={s.id} className="border-t border-zinc-800 align-top">
              <td className="p-1.5">
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={() => onToggle(s.id)}
                />
              </td>
              <td className="p-1">
                <input
                  className={cellCls}
                  value={s.scene}
                  onChange={(e) => updateShot(s.id, { scene: e.target.value })}
                />
              </td>
              <td className="p-1">
                <input
                  className={cellCls}
                  value={s.shotType}
                  onChange={(e) => updateShot(s.id, { shotType: e.target.value })}
                />
              </td>
              <td className="p-1">
                <textarea
                  className={`${cellCls} resize-none`}
                  rows={2}
                  value={s.description}
                  onChange={(e) =>
                    updateShot(s.id, { description: e.target.value })
                  }
                />
              </td>
              <td className="p-1">
                <input
                  className={cellCls}
                  value={s.cameraMove}
                  onChange={(e) =>
                    updateShot(s.id, { cameraMove: e.target.value })
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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

const SPEED_PRESETS = [0.5, 0.75, 1.25, 1.5, 2];

/** 媒体编辑工具条：作用于已完成的视频/音频节点内容，产出新节点。 */
function NodeTools({
  nodeId,
  kind,
  duration,
}: {
  nodeId: string;
  kind: "video" | "audio";
  duration: number;
}) {
  const tools = toolsForKind(kind);
  const [open, setOpen] = useState<string | null>(null); // 展开中的工具 modelId
  const [start, setStart] = useState("0");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  if (!tools.length) return null;

  const run = async (tool: ModelCapability, edit: EditParams) => {
    if (busy) return;
    setBusy(true);
    setOpen(null);
    try {
      await startToolGeneration(nodeId, tool, edit);
    } finally {
      setBusy(false);
    }
  };

  const onToolClick = (tool: ModelCapability) => {
    const mode = tool.modes[0];
    if (mode === "extract-audio") {
      void run(tool, {});
    } else if (mode === "video-trim" || mode === "audio-trim") {
      setEnd(duration ? duration.toFixed(1) : "");
      setStart("0");
      setOpen(open === tool.modelId ? null : tool.modelId);
    } else if (mode === "audio-speed") {
      setOpen(open === tool.modelId ? null : tool.modelId);
    }
  };

  const openTool = tools.find((t) => t.modelId === open);

  return (
    <div className="nodrag mt-1.5 border-t border-zinc-800 pt-1.5">
      <div className="flex flex-wrap gap-1.5">
        {tools.map((t) => (
          <button
            key={t.modelId}
            disabled={busy}
            onClick={() => onToolClick(t)}
            className={`rounded-md px-2 py-1 text-[10px] ${
              open === t.modelId
                ? "bg-zinc-700 text-white"
                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            } disabled:opacity-40`}
          >
            🛠 {t.label}
          </button>
        ))}
      </div>

      {openTool &&
        (openTool.modes[0] === "video-trim" ||
          openTool.modes[0] === "audio-trim") && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-zinc-400">
            <span>起</span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="w-14 rounded bg-zinc-800 px-1 py-0.5 text-zinc-200 outline-none"
            />
            <span>止</span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="w-14 rounded bg-zinc-800 px-1 py-0.5 text-zinc-200 outline-none"
            />
            <span className="text-zinc-600">秒</span>
            <button
              onClick={() =>
                run(openTool, {
                  start: Number(start) || 0,
                  end: Number(end) || 0,
                })
              }
              className="ml-auto rounded bg-emerald-600 px-2 py-0.5 text-white"
            >
              裁取
            </button>
          </div>
        )}

      {openTool && openTool.modes[0] === "audio-speed" && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-400">
          <span>倍速</span>
          {SPEED_PRESETS.map((s) => (
            <button
              key={s}
              onClick={() => run(openTool, { speed: s })}
              className="rounded bg-zinc-800 px-2 py-0.5 text-zinc-200 hover:bg-zinc-700"
            >
              {s}x
            </button>
          ))}
        </div>
      )}
      {busy && (
        <div className="mt-1 text-center text-[10px] text-zinc-500">
          处理中…已新建结果节点
        </div>
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
  useEffect(() => ensureLoaded(), [ensureLoaded]);

  const [editingText, setEditingText] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const [slashOpen, setSlashOpen] = useState(false);
  const [selectedShots, setSelectedShots] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState<string | null>(null);
  const [mediaDuration, setMediaDuration] = useState(0);

  const caps = capabilitiesForKind(data.kind);
  const isCompose = data.kind === "video" && data.providerId === "local";
  const mode = useMemo(() => {
    const inputs = upstreamInputs(id);
    return resolveMode(data.kind, inputs.images.length, inputs.videos.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, edges, nodes, data.kind, upstreamInputs]);
  const cap = findCapability(data.providerId, data.modelId, mode) ?? caps[0];

  const inputs = useMemo(
    () => upstreamInputs(id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, edges, nodes, upstreamInputs]
  );

  // 与服务端同一套校验，用于实时连线/参数提示
  const validation = useMemo(
    () =>
      validateAndNormalize({
        providerId: data.providerId,
        modelId: data.modelId,
        mode,
        prompt: data.prompt,
        images: inputs.images,
        videos: inputs.videos,
        audios: inputs.audios,
        refTexts: inputs.refTexts,
        params: data.params,
      }),
    [data.providerId, data.modelId, mode, data.prompt, data.params, inputs]
  );

  const busy = data.status === "queued" || data.status === "generating";
  const canGenerate = validation.ok && !busy;
  const hint =
    !validation.ok && validation.message !== "请输入提示词"
      ? validation.message
      : null;

  // 合成节点展示的上游片段顺序（与生成时一致：连接顺序）
  const composeList = useMemo(() => {
    if (!isCompose) return [];
    return edges
      .filter((e) => e.target === id)
      .map((e) => nodes.find((n) => n.id === e.source))
      .filter((n): n is LibNodeType => !!n)
      .map((n) => ({
        id: n.id,
        kind: n.data.kind,
        ready: n.data.status === "done" && !!n.data.content,
      }));
  }, [isCompose, edges, nodes, id]);

  const onModelChange = (key: string) => {
    const next = caps.find((c) => capabilityKey(c) === key);
    if (!next) return;
    updateNodeData(id, {
      providerId: next.providerId,
      modelId: next.modelId,
      params: reconcileParams(next, data.params),
    });
  };

  const onPromptChange = (value: string) => {
    updateNodeData(id, { prompt: value });
    setSlashOpen(
      data.kind === "image" && inputs.images.length > 0 && value.startsWith("/")
    );
  };

  const slashFiltered = useMemo(() => {
    if (!slashOpen) return [];
    const q = data.prompt.slice(1).trim().toLowerCase();
    return SLASH_PRESETS.filter(
      (p) => !q || p.label.toLowerCase().includes(q) || p.key.includes(q)
    );
  }, [slashOpen, data.prompt]);

  const runBatch = async (
    label: string,
    fn: (id: string, shots?: string[]) => Promise<[number, number]>
  ) => {
    if (batchBusy) return;
    setBatchBusy(label);
    try {
      await fn(id, selectedShots.size ? [...selectedShots] : undefined);
    } finally {
      setBatchBusy(null);
    }
  };

  const renderContent = () => {
    if (data.status === "queued" || data.status === "generating") {
      return <Spinner data={data} />;
    }
    if (data.status === "error") {
      return (
        <div className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg bg-red-500/5 p-3 text-center text-xs text-red-300">
          <span className="text-base">⚠️</span>
          {data.errorMessage ?? "生成失败，请重试"}
        </div>
      );
    }
    if (data.kind === "text" && editingText) {
      return (
        <div className="nodrag p-1">
          <textarea
            autoFocus
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            rows={6}
            className="w-full resize-none rounded-md bg-zinc-800 p-2 text-xs text-zinc-200 outline-none"
            placeholder="输入文本内容…"
          />
          <div className="mt-1 flex justify-end gap-2">
            <button
              className="rounded-md px-2 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800"
              onClick={() => setEditingText(false)}
            >
              取消
            </button>
            <button
              className="rounded-md bg-blue-600 px-2 py-0.5 text-[11px] text-white"
              onClick={() => {
                updateNodeData(id, {
                  content: textDraft.trim() || null,
                  status: textDraft.trim() ? "done" : "idle",
                });
                setEditingText(false);
              }}
            >
              保存
            </button>
          </div>
        </div>
      );
    }
    if (!data.content && !data.shots) {
      return (
        <div className="flex h-24 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/8 text-xs text-zinc-500">
          <span className="text-2xl opacity-25 grayscale">{meta.icon}</span>
          <span className="text-[11px]">
            {isCompose ? "连入视频后点击「合成」" : "输入提示词并点击生成"}
          </span>
          {data.kind === "text" && (
            <button
              className="nodrag rounded-md border border-[var(--border)] px-2 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-white/5"
              onClick={() => {
                setTextDraft("");
                setEditingText(true);
              }}
            >
              ✍️ 自己编写内容
            </button>
          )}
        </div>
      );
    }
    switch (data.kind) {
      case "text":
        return (
          <div className="group relative">
            <div className="max-h-48 overflow-auto whitespace-pre-wrap p-2 text-xs leading-relaxed text-zinc-200">
              {data.content}
            </div>
            <button
              className="nodrag absolute right-1 top-1 hidden rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400 group-hover:block"
              onClick={() => {
                setTextDraft(data.content ?? "");
                setEditingText(true);
              }}
            >
              编辑
            </button>
          </div>
        );
      case "image":
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.content!}
            alt="生成图片"
            className="w-full rounded-lg ring-1 ring-white/5"
            draggable={false}
          />
        );
      case "video":
        return (
          <video
            src={data.content!}
            controls
            className="w-full rounded-lg ring-1 ring-white/5"
            onLoadedMetadata={(e) =>
              setMediaDuration(e.currentTarget.duration || 0)
            }
          />
        );
      case "audio":
        return (
          <audio
            src={data.content!}
            controls
            className="w-full"
            onLoadedMetadata={(e) =>
              setMediaDuration(e.currentTarget.duration || 0)
            }
          />
        );
      case "script":
        return (
          <ShotTable
            nodeId={id}
            shots={data.shots ?? []}
            selected={selectedShots}
            onToggle={(shotId) =>
              setSelectedShots((prev) => {
                const next = new Set(prev);
                if (next.has(shotId)) next.delete(shotId);
                else next.add(shotId);
                return next;
              })
            }
          />
        );
    }
  };

  const statusDot =
    data.status === "done"
      ? "#34d399"
      : data.status === "error"
        ? "#f87171"
        : data.status === "generating" || data.status === "queued"
          ? "#fbbf24"
          : "#52525b";

  return (
    <div
      className={`group/node overflow-hidden rounded-2xl border bg-[var(--bg-elevated)]/95 backdrop-blur transition-all duration-150 ${
        selected
          ? "shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
          : "shadow-[0_4px_20px_rgba(0,0,0,0.4)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.5)]"
      } ${data.kind === "script" ? "w-[480px]" : "w-72"}`}
      style={{
        borderColor: selected ? meta.accent : "var(--border)",
        boxShadow: selected ? `0 0 0 1px ${meta.accent}` : undefined,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!border-2"
        style={{ background: meta.accent, borderColor: "var(--bg-elevated)" }}
      />
      <div
        className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-white"
        style={{
          background: `linear-gradient(180deg, ${meta.accent}22, ${meta.accent}0d)`,
          borderBottom: `1px solid ${meta.accent}22`,
        }}
      >
        <span
          className="flex h-5 w-5 items-center justify-center rounded-md text-[12px]"
          style={{ background: `${meta.accent}2e` }}
        >
          {meta.icon}
        </span>
        <span className="tracking-tight">
          {isCompose ? "视频合成" : `${meta.label}节点`}
        </span>
        <span
          className="ml-auto truncate rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-normal text-zinc-300"
          title={cap.label}
        >
          {cap.label}
        </span>
        <span
          className="h-2 w-2 shrink-0 rounded-full transition-colors"
          style={{
            background: statusDot,
            boxShadow:
              data.status === "generating" || data.status === "queued"
                ? `0 0 6px ${statusDot}`
                : undefined,
          }}
        />
      </div>

      <div className="p-2">
        {renderContent()}
        {data.status === "error" && (
          <button
            onClick={() => void retryGeneration(id)}
            className="nodrag mt-1 w-full rounded-md border border-zinc-700 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
          >
            重试
          </button>
        )}
        {/* 媒体编辑工具：已完成的视频/音频节点 */}
        {data.status === "done" &&
          data.content &&
          (data.kind === "video" || data.kind === "audio") && (
            <NodeTools
              nodeId={id}
              kind={data.kind}
              duration={mediaDuration}
            />
          )}
        {/* 脚本流水线：生成分镜图 / 批量生成视频 */}
        {data.kind === "script" && (data.shots?.length ?? 0) > 0 && (
          <div className="nodrag mt-1.5 flex gap-2">
            <button
              disabled={!!batchBusy}
              onClick={() => void runBatch("images", generateShotImages)}
              className="flex-1 rounded-lg bg-gradient-to-b from-violet-500 to-violet-600 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-all hover:brightness-110 active:scale-95 disabled:opacity-40"
            >
              {batchBusy === "images" ? "分镜图生成中…" : "🖼️ 生成分镜图"}
            </button>
            <button
              disabled={!!batchBusy}
              onClick={() => void runBatch("videos", generateShotVideos)}
              className="flex-1 rounded-lg bg-gradient-to-b from-amber-500 to-amber-600 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-all hover:brightness-110 active:scale-95 disabled:opacity-40"
            >
              {batchBusy === "videos" ? "视频生成中…" : "🎥 批量生成视频"}
            </button>
          </div>
        )}
        {data.kind === "script" && (data.shots?.length ?? 0) > 0 && (
          <div className="mt-1 text-center text-[10px] text-zinc-500">
            {selectedShots.size
              ? `已勾选 ${selectedShots.size} 个分镜`
              : "未勾选则处理全部分镜"}
          </div>
        )}
        {/* 合成节点：展示拼接顺序 */}
        {isCompose && composeList.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {composeList.map((c, i) => (
              <div
                key={c.id}
                className="flex items-center gap-2 rounded-md bg-zinc-800/60 px-2 py-1 text-[10px] text-zinc-400"
              >
                <span className="text-zinc-500">{i + 1}.</span>
                <span>{c.kind === "audio" ? "🎵 BGM 音轨" : `🎞️ 片段`}</span>
                <span className="ml-auto">{c.ready ? "✓ 就绪" : "⏳ 未就绪"}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="nodrag border-t border-[var(--border)] p-2">
        {!isCompose && (
          <div className="relative">
            <textarea
              value={data.prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              onBlur={() => setTimeout(() => setSlashOpen(false), 200)}
              placeholder={
                data.kind === "script"
                  ? "描述剧情，生成分镜脚本…"
                  : data.kind === "image" && inputs.images.length > 0
                    ? "输入提示词，或输入 / 唤出快捷指令…"
                    : `输入${meta.label}生成提示词…`
              }
              rows={2}
              className="w-full resize-none rounded-lg border border-transparent bg-black/30 p-2 text-xs text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-[var(--accent)]/60 focus:bg-black/40"
            />
            {slashOpen && slashFiltered.length > 0 && (
              <div className="lib-fade-in absolute bottom-full left-0 z-50 mb-1 max-h-48 w-full overflow-auto rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-1 shadow-2xl">
                {slashFiltered.map((p) => (
                  <button
                    key={p.key}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      updateNodeData(id, { prompt: p.prompt });
                      setSlashOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[11px] text-zinc-200 hover:bg-white/5"
                  >
                    <span>{p.icon}</span>
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

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
            className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-black/30 px-2 py-1.5 text-[11px] text-zinc-300 outline-none transition-colors hover:border-[var(--border-strong)] focus:border-[var(--accent)]/60"
          >
            {caps.map((c) => {
              const unavailable = availability[c.providerId] === false;
              return (
                <option
                  key={capabilityKey(c)}
                  value={capabilityKey(c)}
                  disabled={unavailable}
                >
                  {c.label}
                  {unavailable ? "（未配置）" : ""}
                </option>
              );
            })}
          </select>
          <button
            onClick={() => void startGeneration(id)}
            disabled={!canGenerate}
            className="shrink-0 rounded-lg px-3.5 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-all hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:brightness-100"
            style={{
              background: `linear-gradient(180deg, ${meta.accent}, ${meta.accent}cc)`,
            }}
          >
            {busy ? (isCompose ? "合成中" : "生成中") : isCompose ? "合成" : "生成"}
          </button>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!border-2"
        style={{ background: meta.accent, borderColor: "var(--bg-elevated)" }}
      />
    </div>
  );
}

export const LibNodeComponent = memo(LibNodeInner);
