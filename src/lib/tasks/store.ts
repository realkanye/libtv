// 任务持久化存储（Phase 1：文件存储，不上重型数据库）。
//
// 写入采用「写临时文件 + rename」的原子替换，避免崩溃时写坏文件。
// 写操作串行化（promise 链）避免并发竞态。进程重启后从磁盘恢复，
// 配合 hub.resume() 让进行中的任务不中断。

import { mkdir, rename, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { TaskRecord } from "./types";

const DATA_DIR = join(process.cwd(), ".data");
const DATA_FILE = join(DATA_DIR, "tasks.json");

/** 终态任务保留时长（24h），过期清理。 */
const RETENTION_MS = 24 * 60 * 60 * 1000;

export class TaskStore {
  private cache = new Map<string, TaskRecord>();
  private writeChain: Promise<void> = Promise.resolve();
  private loaded = false;

  /** 同步加载（首次访问时调用），保证 hub 初始化即可恢复任务。 */
  private ensureLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (existsSync(DATA_FILE)) {
        const raw = readFileSync(DATA_FILE, "utf8");
        const arr = JSON.parse(raw) as TaskRecord[];
        for (const t of arr) this.cache.set(t.id, t);
      }
    } catch {
      // 文件损坏不应阻塞启动；从空状态开始。
      this.cache.clear();
    }
  }

  get(id: string): TaskRecord | undefined {
    this.ensureLoaded();
    return this.cache.get(id);
  }

  all(): TaskRecord[] {
    this.ensureLoaded();
    return [...this.cache.values()];
  }

  upsert(record: TaskRecord): TaskRecord {
    this.ensureLoaded();
    this.cache.set(record.id, record);
    this.persist();
    return record;
  }

  remove(id: string) {
    this.ensureLoaded();
    if (this.cache.delete(id)) this.persist();
  }

  /** 清理过期的终态任务。 */
  prune() {
    this.ensureLoaded();
    const now = Date.now();
    let changed = false;
    for (const [id, t] of this.cache) {
      const terminal = t.status === "succeeded" || t.status === "failed";
      if (terminal && now - t.updatedAt > RETENTION_MS) {
        this.cache.delete(id);
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  /** 串行化的原子持久化。 */
  private persist() {
    const snapshot = JSON.stringify([...this.cache.values()]);
    this.writeChain = this.writeChain
      .then(async () => {
        await mkdir(dirname(DATA_FILE), { recursive: true });
        const tmp = `${DATA_FILE}.${process.pid}.tmp`;
        await writeFile(tmp, snapshot, "utf8");
        await rename(tmp, DATA_FILE);
      })
      .catch((e) => {
        console.error("[TaskStore] 持久化失败:", e);
      });
  }

  /** 等待挂起的写入落盘（测试用）。 */
  async flush() {
    await this.writeChain;
  }
}

// 单例（globalThis 以在 dev HMR 下保持）。
const KEY = Symbol.for("libtv.taskStore");
type GlobalWithStore = typeof globalThis & { [KEY]?: TaskStore };
const g = globalThis as GlobalWithStore;

export function getTaskStore(): TaskStore {
  if (!g[KEY]) g[KEY] = new TaskStore();
  return g[KEY];
}

export { DATA_FILE };
