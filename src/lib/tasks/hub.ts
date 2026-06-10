// 异步任务中枢。
//
// 职责：
//  - create()：构造任务、立即持久化并返回（POST 快速响应），后台执行创建。
//  - 统一轮询器：服务端集中、按任务做指数退避轮询，而非浏览器各自轮询。
//  - SSE 发布订阅：任务状态变化推送给订阅的前端节点。
//  - 产物转存：完成后把时效 URL 下载到本地。
//  - resume()：进程重启后恢复进行中的任务。
//
// 仅服务端导入。单例挂在 globalThis 上以在 dev HMR 下保持。

import { getProvider } from "@/lib/providers/registry";
import { ProviderError } from "@/lib/providers/types";
import type {
  ProviderErrorCode,
  UnifiedRequest,
} from "@/lib/providers/types";
import { getTaskStore, type TaskStore } from "./store";
import { isTerminal, toView, type TaskRecord, type TaskView } from "./types";
import { localizeOutputs } from "./assets";

const TICK_MS = 700; // 轮询器节拍
const POLL_BASE_MS = 1000; // 退避基数
const POLL_MAX_MS = 8000; // 退避上限
const TASK_TTL_MS = 10 * 60 * 1000; // 任务最长存活（超时判定）

type Listener = (view: TaskView) => void;

let seq = 0;

export class TaskHub {
  private store: TaskStore = getTaskStore();
  private listeners = new Map<string, Set<Listener>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private polling = new Set<string>();

  // ──────────────────────────── 创建 ────────────────────────────

  /** 创建任务并立即返回（后台执行实际创建）。 */
  create(nodeId: string, request: UnifiedRequest): TaskRecord {
    const now = Date.now();
    const id = `task-${now}-${++seq}`;
    const record: TaskRecord = {
      id,
      nodeId,
      request,
      providerId: request.providerId,
      modelId: request.modelId,
      mode: request.mode,
      status: "queued",
      progress: 0,
      outputs: [],
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      nextPollAt: now,
      expiresAt: now + TASK_TTL_MS,
    };
    this.store.upsert(record);
    this.emit(record);
    void this.runCreate(record);
    return record;
  }

  private async runCreate(task: TaskRecord) {
    const provider = getProvider(task.providerId);
    try {
      const result = await provider.createTask(task.request);
      const current = this.store.get(task.id);
      if (!current || isTerminal(current.status)) return; // 可能已被重试/清理
      if (result.kind === "sync") {
        const outputs = await localizeOutputs(task.id, result.outputs);
        this.finishSuccess(task.id, outputs);
      } else {
        this.patch(task.id, {
          upstreamTaskId: result.upstreamTaskId,
          status: "running",
          nextPollAt: Date.now() + POLL_BASE_MS,
        });
        this.ensureTicker();
      }
    } catch (e) {
      this.finishError(task.id, toErrorInfo(e));
    }
  }

  // ──────────────────────────── 轮询 ────────────────────────────

  private ensureTicker() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.tick(), TICK_MS);
  }

  private activeTasks(): TaskRecord[] {
    return this.store
      .all()
      .filter((t) => t.status === "running" && !!t.upstreamTaskId);
  }

  private async tick() {
    this.timer = null;
    const now = Date.now();
    const due = this.activeTasks().filter(
      (t) => t.nextPollAt <= now && !this.polling.has(t.id)
    );
    await Promise.all(due.map((t) => this.pollOne(t.id)));

    // 仍有进行中的任务则继续轮询，否则停摆。
    if (this.activeTasks().length > 0) {
      this.timer = setTimeout(() => this.tick(), TICK_MS);
    }
  }

  private async pollOne(id: string) {
    const task = this.store.get(id);
    if (!task || task.status !== "running" || !task.upstreamTaskId) return;

    // 超时判定
    if (Date.now() > task.expiresAt) {
      this.finishError(id, {
        code: "timeout",
        message: "生成超时，请重试",
      });
      return;
    }

    this.polling.add(id);
    try {
      const provider = getProvider(task.providerId);
      const state = await provider.getTask(task.upstreamTaskId);
      const fresh = this.store.get(id);
      if (!fresh || isTerminal(fresh.status)) return;

      if (state.status === "succeeded") {
        const outputs = await localizeOutputs(id, state.outputs ?? []);
        this.finishSuccess(id, outputs);
      } else if (state.status === "failed") {
        this.finishError(id, state.error ?? {
          code: "upstream_error",
          message: "生成失败",
        });
      } else {
        const attempts = task.attempts + 1;
        this.patch(id, {
          attempts,
          progress: state.progress ?? task.progress,
          nextPollAt: Date.now() + backoff(attempts),
        });
      }
    } catch (e) {
      const info = toErrorInfo(e);
      const retryable = e instanceof ProviderError ? e.retryable : true;
      if (retryable) {
        // 暂时性错误：退避后重试，由 expiresAt 兜底超时。
        const attempts = task.attempts + 1;
        this.patch(id, { attempts, nextPollAt: Date.now() + backoff(attempts) });
      } else {
        this.finishError(id, info);
      }
    } finally {
      this.polling.delete(id);
    }
  }

  // ──────────────────────────── 状态更新 ────────────────────────────

  private patch(id: string, patch: Partial<TaskRecord>) {
    const cur = this.store.get(id);
    if (!cur) return;
    const next = { ...cur, ...patch, updatedAt: Date.now() };
    this.store.upsert(next);
    this.emit(next);
  }

  private finishSuccess(id: string, outputs: TaskRecord["outputs"]) {
    this.patch(id, { status: "succeeded", progress: 100, outputs, error: undefined });
  }

  private finishError(
    id: string,
    error: { code: ProviderErrorCode; message: string }
  ) {
    this.patch(id, { status: "failed", error });
  }

  // ──────────────────────────── 重试 ────────────────────────────

  /** 用原始请求重跑任务。 */
  retry(id: string): TaskRecord | undefined {
    const cur = this.store.get(id);
    if (!cur) return undefined;
    const now = Date.now();
    const reset: TaskRecord = {
      ...cur,
      status: "queued",
      progress: 0,
      outputs: [],
      error: undefined,
      upstreamTaskId: undefined,
      attempts: 0,
      updatedAt: now,
      nextPollAt: now,
      expiresAt: now + TASK_TTL_MS,
    };
    this.store.upsert(reset);
    this.emit(reset);
    void this.runCreate(reset);
    return reset;
  }

  // ──────────────────────────── 订阅 / 查询 ────────────────────────────

  subscribe(id: string, listener: Listener): () => void {
    let set = this.listeners.get(id);
    if (!set) {
      set = new Set();
      this.listeners.set(id, set);
    }
    set.add(listener);
    return () => {
      const s = this.listeners.get(id);
      if (s) {
        s.delete(listener);
        if (s.size === 0) this.listeners.delete(id);
      }
    };
  }

  getView(id: string): TaskView | undefined {
    const t = this.store.get(id);
    return t ? toView(t) : undefined;
  }

  private emit(record: TaskRecord) {
    const view = toView(record);
    const set = this.listeners.get(record.id);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(view);
      } catch {
        // 单个订阅者异常不影响其它订阅者。
      }
    }
  }

  // ──────────────────────────── 恢复 ────────────────────────────

  /** 进程重启后恢复进行中的任务。 */
  resume() {
    this.store.prune();
    let hasActive = false;
    const now = Date.now();
    for (const t of this.store.all()) {
      if (isTerminal(t.status)) continue;
      if (t.status === "running" && t.upstreamTaskId) {
        // 重新纳入轮询。
        this.patch(t.id, { nextPollAt: now });
        hasActive = true;
      } else {
        // queued 但创建未完成（崩溃在创建途中）：判定失败，让用户重试。
        this.finishError(t.id, {
          code: "upstream_error",
          message: "服务已重启，请重新生成",
        });
      }
    }
    if (hasActive) this.ensureTicker();
  }
}

function backoff(attempts: number): number {
  return Math.min(POLL_BASE_MS * Math.pow(1.5, attempts), POLL_MAX_MS);
}

function toErrorInfo(e: unknown): {
  code: ProviderErrorCode;
  message: string;
} {
  if (e instanceof ProviderError) {
    return { code: e.code, message: e.message };
  }
  return { code: "upstream_error", message: (e as Error)?.message ?? "未知错误" };
}

// 单例
const KEY = Symbol.for("libtv.taskHub");
type GlobalWithHub = typeof globalThis & { [KEY]?: TaskHub };
const g = globalThis as GlobalWithHub;

export function getTaskHub(): TaskHub {
  if (!g[KEY]) g[KEY] = new TaskHub();
  return g[KEY];
}
