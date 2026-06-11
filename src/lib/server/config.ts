// 运行时配置存储：把设置页填写的密钥/模型 ID 持久化到 .data/config.json。
// 优先级：设置页(文件) > 环境变量 > 内置默认值。
// 仅服务端使用。所有密钥只落在服务端文件，浏览器只拿到「是否已配置 + 掩码」。

import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface AppConfig {
  arkApiKey?: string;
  arkBaseUrl?: string;
  arkSeedreamModel?: string;
  arkSeedanceModel?: string;
  arkLlmModel?: string;
  klingAccessKey?: string;
  klingSecretKey?: string;
  klingBaseUrl?: string;
}

/** 可在设置页编辑的字段（含是否为密钥，用于掩码）。 */
export const CONFIG_FIELDS: { key: keyof AppConfig; secret: boolean }[] = [
  { key: "arkApiKey", secret: true },
  { key: "arkBaseUrl", secret: false },
  { key: "arkSeedreamModel", secret: false },
  { key: "arkSeedanceModel", secret: false },
  { key: "arkLlmModel", secret: false },
  { key: "klingAccessKey", secret: true },
  { key: "klingSecretKey", secret: true },
  { key: "klingBaseUrl", secret: false },
];

const CONFIG_FILE = join(process.cwd(), ".data", "config.json");

const ENV_MAP: Record<keyof AppConfig, string> = {
  arkApiKey: "ARK_API_KEY",
  arkBaseUrl: "ARK_BASE_URL",
  arkSeedreamModel: "ARK_SEEDREAM_MODEL",
  arkSeedanceModel: "ARK_SEEDANCE_MODEL",
  arkLlmModel: "ARK_LLM_MODEL",
  klingAccessKey: "KLING_ACCESS_KEY",
  klingSecretKey: "KLING_SECRET_KEY",
  klingBaseUrl: "KLING_BASE_URL",
};

const KEY = Symbol.for("libtv.appConfig");
type GlobalWithConfig = typeof globalThis & { [KEY]?: AppConfig };
const g = globalThis as GlobalWithConfig;

function loadFile(): AppConfig {
  if (g[KEY]) return g[KEY]!;
  let fromFile: AppConfig = {};
  try {
    if (existsSync(CONFIG_FILE)) {
      fromFile = JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as AppConfig;
    }
  } catch {
    fromFile = {};
  }
  g[KEY] = fromFile;
  return fromFile;
}

function clean(v: string | undefined): string | undefined {
  return v && v.trim() ? v.trim() : undefined;
}

/** 读取合并后的配置（文件 > 环境变量）。 */
export function getConfig(): AppConfig {
  const file = loadFile();
  const merged: AppConfig = {};
  for (const { key } of CONFIG_FIELDS) {
    merged[key] = clean(file[key]) ?? clean(process.env[ENV_MAP[key]]);
  }
  return merged;
}

/** 写入设置页提交的配置（仅覆盖传入的非空字段；空字符串=不改）。 */
export async function updateConfig(patch: Partial<AppConfig>): Promise<void> {
  const file = { ...loadFile() };
  for (const { key } of CONFIG_FIELDS) {
    const v = patch[key];
    if (v === undefined) continue;
    const trimmed = typeof v === "string" ? v.trim() : "";
    if (trimmed) file[key] = trimmed;
    // 空字符串：保持原值不变（避免误清空已配置的密钥）
  }
  g[KEY] = file;
  await mkdir(dirname(CONFIG_FILE), { recursive: true });
  const tmp = `${CONFIG_FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2), "utf8");
  await rename(tmp, CONFIG_FILE);
}

/** 掩码展示（保留尾 4 位）。 */
export function maskSecret(v: string | undefined): string {
  if (!v) return "";
  if (v.length <= 4) return "••••";
  return `••••${v.slice(-4)}`;
}

export { CONFIG_FILE };
