import Link from "next/link";
import Canvas from "@/components/Canvas";

export default function Home() {
  return (
    <main className="flex h-screen flex-col bg-[var(--bg)]">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-elevated)]/60 px-4 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 text-[13px] font-black text-white shadow-[0_2px_8px_rgba(139,92,246,0.4)]">
            L
          </span>
          <span className="text-sm font-bold tracking-tight text-white">
            Lib<span className="text-violet-400">TV</span>
          </span>
        </div>
        <span className="hidden text-xs text-zinc-500 sm:inline">
          无限画布 · 未命名项目
        </span>
        <Link
          href="/settings"
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-[var(--border-strong)] hover:bg-white/5"
        >
          <span>⚙️</span>
          <span>设置</span>
        </Link>
      </header>
      <div className="relative min-h-0 flex-1">
        <Canvas />
      </div>
    </main>
  );
}
