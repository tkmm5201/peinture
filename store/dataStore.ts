import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { GeneratedImage, CloudImage } from "../types";
import { indexedDBStorage } from "../services/indexedDBStorage";

export interface DataState {
  history: GeneratedImage[];
  cloudHistory: CloudImage[];

  setHistory: (
    history: GeneratedImage[] | ((prev: GeneratedImage[]) => GeneratedImage[]),
  ) => void;
  setCloudHistory: (
    history: CloudImage[] | ((prev: CloudImage[]) => CloudImage[]),
  ) => void;
}

export const useDataStore = create<DataState>()(
  persist(
    (set) => ({
      history: [],
      cloudHistory: [],

      setHistory: (historyOrFn) =>
        set((state) => ({
          history:
            typeof historyOrFn === "function"
              ? historyOrFn(state.history)
              : historyOrFn,
        })),
      setCloudHistory: (historyOrFn) =>
        set((state) => ({
          cloudHistory:
            typeof historyOrFn === "function"
              ? historyOrFn(state.cloudHistory)
              : historyOrFn,
        })),
    }),
    {
      name: "peinture_data_v1",
      storage: createJSONStorage(() => indexedDBStorage),
      // Migrate data from legacy localStorage on first load
      onRehydrateStorage: () => {
        // Attempt legacy migration before hydration completes
        try {
          const legacyData = localStorage.getItem("peinture_data_v1");
          if (legacyData) {
            // Transfer to IndexedDB and clean up localStorage
            Promise.resolve(
              indexedDBStorage.setItem("peinture_data_v1", legacyData),
            )
              .then(() => {
                localStorage.removeItem("peinture_data_v1");
              })
              .catch(() => {
                // If IndexedDB write fails, keep localStorage as fallback
              });
          }
        } catch {
          // localStorage access may fail in some contexts
        }
      },
    },
  ),
);
