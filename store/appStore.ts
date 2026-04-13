import { useSettingsStore } from "./settingsStore";
import { useConfigStore } from "./configStore";
import { useDataStore } from "./dataStore";
import { useUIStore } from "./uiStore";

export const useAppStore = () =>
  ({
    ...useSettingsStore(),
    ...useConfigStore(),
    ...useDataStore(),
    ...useUIStore(),
  }) as any; // Type as any to prevent massive circular reference type issues if any, since it's just an aggregator

useAppStore.getState = () =>
  ({
    ...useSettingsStore.getState(),
    ...useConfigStore.getState(),
    ...useDataStore.getState(),
    ...useUIStore.getState(),
  }) as any;

useAppStore.subscribe = (listener: any) => {
  // For basic compatibility. Real usage should migrate to specific stores.
  const unsubSettings = useSettingsStore.subscribe(listener);
  const unsubConfig = useConfigStore.subscribe(listener);
  const unsubData = useDataStore.subscribe(listener);
  const unsubUI = useUIStore.subscribe(listener);

  return () => {
    unsubSettings();
    unsubConfig();
    unsubData();
    unsubUI();
  };
};
