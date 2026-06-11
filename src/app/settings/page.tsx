"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface FieldInfo {
  key: string;
  secret: boolean;
  configured: boolean;
  masked?: string;
  value?: string;
  hint: string;
}

interface ProviderInfo {
  id: string;
  label: string;
  configured: boolean;
}

const LABELS: Record<string, string> = {
  arkApiKey: "API Key",
  arkBaseUrl: "API 网关地址（可选）",
  arkSeedreamModel: "Seedream 生图模型 ID",
  arkSeedanceModel: "Seedance 视频模型 ID",
  arkLlmModel: "豆包 LLM 模型 ID（文本/分镜）",
  klingAccessKey: "AccessKey",
  klingSecretKey: "SecretKey",
  klingBaseUrl: "API 网关地址（可选）",
};

const GROUPS: { title: string; desc: string; keys: string[] }[] = [
  {
    title: "火山方舟（即梦 / 字节）",
    desc: "一个 API Key 同时驱动 Seedream 生图、Seedance 视频、豆包 LLM。模型 ID 请填你账号里实际开通的接入点 ID（带版本后缀也没关系）。",
    keys: [
      "arkApiKey",
      "arkSeedreamModel",
      "arkSeedanceModel",
      "arkLlmModel",
      "arkBaseUrl",
    ],
  },
  {
    title: "可灵 Kling",
    desc: "AccessKey / SecretKey 在服务端签发短时效 JWT，浏览器永不接触密钥。驱动可灵视频（文生/图生/首尾帧）与生图。",
    keys: ["klingAccessKey", "klingSecretKey", "klingBaseUrl"],
  },
];

export default function SettingsPage() {
  const [fields, setFields] = useState<Record<string, FieldInfo>>({});
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: { fields: FieldInfo[]; providers: ProviderInfo[] }) => {
        const map: Record<string, FieldInfo> = {};
        const initial: Record<string, string> = {};
        for (const f of d.fields) {
          map[f.key] = f;
          // 非密钥字段预填当前值；密钥字段留空（占位提示已配置）
          initial[f.key] = f.secret ? "" : (f.value ?? "");
        }
        setFields(map);
        setDrafts(initial);
        setProviders(d.providers);
      })
      .catch(() => setToast("加载配置失败"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(drafts),
      });
      if (!res.ok) throw new Error();
      setToast("已保存，立即生效");
      load();
    } catch {
      setToast("保存失败，请重试");
    } finally {
      setSaving(false);
      setTimeout(() => setToast(null), 2500);
    }
  };

  const providerLabel = (id: string) =>
    providers.find((p) => p.id === id)?.configured;

  return (
    <main className="min-h-screen bg-[var(--bg)] text-zinc-200">
      <header className="sticky top-0 z-10 flex h-12 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-elevated)] px-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 text-[13px] font-black text-white shadow-[0_2px_8px_rgba(139,92,246,0.4)]">
            L
          </span>
          <span className="text-sm font-bold tracking-tight text-white">
            Lib<span className="text-violet-400">TV</span>
          </span>
        </Link>
        <span className="text-xs text-zinc-500">设置 · 模型密钥</span>
        <Link
          href="/"
          className="ml-auto rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-[var(--border-strong)] hover:bg-white/5"
        >
          ← 返回画布
        </Link>
      </header>

      <div className="mx-auto max-w-2xl p-6">
        <div className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/60 p-3.5 text-xs leading-relaxed text-zinc-400">
          密钥只保存在<strong className="text-zinc-200">本机服务端</strong>
          （<code className="text-zinc-300">.data/config.json</code>
          ），浏览器只能看到掩码。留空的密钥字段在保存时
          <strong className="text-zinc-200">不会覆盖</strong>已有值。
          未配置的 Provider 在画布中会自动置灰，Mock 与本地 ffmpeg 合成/剪辑始终可用。
        </div>

        {/* 可用性状态 */}
        <div className="mb-6 flex flex-wrap gap-2">
          {providers.map((p) => (
            <span
              key={p.id}
              className={`rounded-full px-3 py-1 text-[11px] ${
                p.configured
                  ? "bg-emerald-600/20 text-emerald-300"
                  : "bg-zinc-800 text-zinc-500"
              }`}
            >
              {p.configured ? "✓ " : "○ "}
              {p.label}
            </span>
          ))}
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-zinc-600">加载中…</div>
        ) : (
          <div className="space-y-6">
            {GROUPS.map((group) => (
              <section
                key={group.title}
                className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)]/50 p-4 shadow-[0_4px_20px_rgba(0,0,0,0.25)]"
              >
                <h2 className="text-sm font-semibold text-white">
                  {group.title}
                </h2>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                  {group.desc}
                </p>
                <div className="mt-3 space-y-3">
                  {group.keys.map((key) => {
                    const f = fields[key];
                    if (!f) return null;
                    return (
                      <div key={key}>
                        <label className="mb-1 block text-[11px] text-zinc-400">
                          {LABELS[key] ?? key}
                          {f.secret && f.configured && (
                            <span className="ml-2 text-emerald-400">
                              已配置 {f.masked}
                            </span>
                          )}
                        </label>
                        <input
                          type={f.secret ? "password" : "text"}
                          value={drafts[key] ?? ""}
                          onChange={(e) =>
                            setDrafts((d) => ({ ...d, [key]: e.target.value }))
                          }
                          placeholder={
                            f.secret
                              ? f.configured
                                ? "留空则不修改"
                                : "未配置"
                              : f.hint || ""
                          }
                          autoComplete="off"
                          className="w-full rounded-lg border border-[var(--border)] bg-black/30 px-3 py-2 text-xs text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-[var(--accent)]/70 focus:bg-black/40"
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving || loading}
            className="rounded-lg bg-gradient-to-b from-violet-500 to-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(139,92,246,0.35)] transition-all hover:brightness-110 active:scale-95 disabled:opacity-40"
          >
            {saving ? "保存中…" : "保存配置"}
          </button>
          {toast && <span className="text-xs text-zinc-400">{toast}</span>}
        </div>
      </div>
    </main>
  );
}
