"use client";

// 客户端缓存「哪些 Provider 已配置」，用于把未配置的模型置灰。
// 能力目录本身是纯数据，客户端直接 import catalog 即可，无需请求。

import { create } from "zustand";
import type { ProviderId } from "./providers/types";

interface AvailabilityState {
  availability: Partial<Record<ProviderId, boolean>>;
  loaded: boolean;
  ensureLoaded: () => void;
}

let started = false;

export const useProviderAvailability = create<AvailabilityState>((set) => ({
  availability: {},
  loaded: false,
  ensureLoaded: () => {
    if (started) return;
    started = true;
    fetch("/api/providers")
      .then((r) => r.json())
      .then((d: { providers: { id: ProviderId; configured: boolean }[] }) => {
        const map: Partial<Record<ProviderId, boolean>> = {};
        for (const p of d.providers) map[p.id] = p.configured;
        set({ availability: map, loaded: true });
      })
      .catch(() => {
        started = false; // 允许重试
      });
  },
}));
