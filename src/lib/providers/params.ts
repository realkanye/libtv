// 参数面板相关的纯helper（客户端 / 服务端通用，无副作用）。

import type { GenerationParams, ModelCapability } from "./types";

/** 取某能力的全部参数默认值。 */
export function paramDefaults(cap: ModelCapability): GenerationParams {
  const p = cap.params;
  const out: GenerationParams = {};
  if (p.aspectRatio) out.aspectRatio = p.aspectRatio.default;
  if (p.duration) out.duration = p.duration.default;
  if (p.count) out.count = p.count.default;
  if (p.resolution) out.resolution = p.resolution.default;
  return out;
}

/** 合并旧参数与新能力的默认值：保留仍合法的旧值，其余回落默认。 */
export function reconcileParams(
  cap: ModelCapability,
  prev: GenerationParams
): GenerationParams {
  const p = cap.params;
  const out: GenerationParams = {};
  if (p.aspectRatio) {
    out.aspectRatio = p.aspectRatio.options.includes(prev.aspectRatio ?? "")
      ? prev.aspectRatio
      : p.aspectRatio.default;
  }
  if (p.duration) {
    out.duration =
      prev.duration != null && p.duration.options.includes(prev.duration)
        ? prev.duration
        : p.duration.default;
  }
  if (p.count) {
    out.count =
      prev.count != null && p.count.options.includes(prev.count)
        ? prev.count
        : p.count.default;
  }
  if (p.resolution) {
    out.resolution = p.resolution.options.includes(prev.resolution ?? "")
      ? prev.resolution
      : p.resolution.default;
  }
  return out;
}
