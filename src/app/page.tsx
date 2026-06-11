import Link from "next/link";
import Canvas from "@/components/Canvas";

export default function Home() {
  return (
    <main className="flex h-screen flex-col bg-zinc-950">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800 px-4">
        <span className="text-sm font-bold tracking-wide text-white">
          Lib<span className="text-violet-400">TV</span>
        </span>
        <span className="text-xs text-zinc-500">无限画布 · 未命名项目</span>
        <Link
          href="/settings"
          className="ml-auto rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          ⚙️ 设置
        </Link>
      </header>
      <div className="relative min-h-0 flex-1">
        <Canvas />
      </div>
    </main>
  );
}
