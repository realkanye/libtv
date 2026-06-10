// 服务端启动钩子：进程（重）启动时恢复进行中的任务，让生成不中断。
// 仅在 Node 运行时执行（动态 import 避免 Edge 运行时加载 Node 模块）。

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getTaskHub } = await import("@/lib/tasks/hub");
    getTaskHub().resume();
  }
}
