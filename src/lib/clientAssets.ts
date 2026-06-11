"use client";

// 「我的资产」：把节点内容保存为可复用资产（localStorage 持久化）。
// 之后可在左侧栏查看并一键发送回画布。

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { NodeKind, ShotRow } from "./types";

export interface CanvasAsset {
  id: string;
  name: string;
  kind: NodeKind;
  content: string | null;
  shots: ShotRow[] | null;
  createdAt: number;
}

interface AssetState {
  assets: CanvasAsset[];
  addAsset: (a: Omit<CanvasAsset, "id" | "createdAt">) => void;
  removeAsset: (id: string) => void;
}

export const useAssetStore = create<AssetState>()(
  persist(
    (set, get) => ({
      assets: [],
      addAsset: (a) =>
        set({
          assets: [
            {
              ...a,
              id: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              createdAt: Date.now(),
            },
            ...get().assets,
          ].slice(0, 200),
        }),
      removeAsset: (id) =>
        set({ assets: get().assets.filter((a) => a.id !== id) }),
    }),
    { name: "libtv-assets-v1" }
  )
);
