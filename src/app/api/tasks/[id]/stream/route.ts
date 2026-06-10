// GET /api/tasks/[id]/stream — Server-Sent Events 任务状态流。
// 节点订阅后实时收到「排队→生成中(xx%)→完成/失败」，无需浏览器轮询。

import { getTaskHub } from "@/lib/tasks/hub";
import { isTerminal, type TaskView } from "@/lib/tasks/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const hub = getTaskHub();
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
      };
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const sendView = (view: TaskView) =>
        safeEnqueue(`data: ${JSON.stringify(view)}\n\n`);

      const initial = hub.getView(id);
      if (!initial) {
        safeEnqueue(
          `event: notfound\ndata: ${JSON.stringify({ error: "任务不存在或已过期" })}\n\n`
        );
        cleanup();
        controller.close();
        return;
      }

      sendView(initial);
      if (isTerminal(initial.status)) {
        cleanup();
        controller.close();
        return;
      }

      unsubscribe = hub.subscribe(id, (view) => {
        sendView(view);
        if (isTerminal(view.status)) {
          cleanup();
          try {
            controller.close();
          } catch {
            // 已关闭
          }
        }
      });

      // 心跳，避免代理/浏览器断开闲置连接。
      heartbeat = setInterval(() => safeEnqueue(`: ping\n\n`), 15000);
    },
    cancel() {
      // 客户端断开（节点卸载 / 页面关闭）
      closed = true;
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
