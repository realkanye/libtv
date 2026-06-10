import Canvas from "@/components/Canvas";

export default function Home() {
  return (
    <main className="flex h-screen flex-col bg-zinc-950">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800 px-4">
        <span className="text-sm font-bold tracking-wide text-white">
          Lib<span className="text-violet-400">TV</span>
        </span>
        <span className="text-xs text-zinc-500">无限画布 · 未命名项目</span>
        <span className="ml-auto rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400">
          Phase 1 · Provider 抽象 + 任务中枢
        </span>
      </header>
      <div className="relative min-h-0 flex-1">
        <Canvas />
      </div>
    </main>
  );
}
