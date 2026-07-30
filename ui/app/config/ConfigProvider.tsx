import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type AppConfig, EMPTY_CONFIG, isConfigured } from "./types";
import { canWriteConfig, loadConfig, saveConfig, type LoadedConfig } from "./store";

interface ConfigContextValue {
  config: AppConfig;
  /** True until the settings object has been fetched — queries must wait for this. */
  isLoading: boolean;
  error?: Error;
  /** False when the environment has never been configured (or config is incomplete). */
  configured: boolean;
  /** False when the user lacks settings write permission (Configuration page is read-only). */
  canEdit: boolean;
  /** Persist a new config; resolves once stored. Throws on failure so the UI can report it. */
  save: (next: AppConfig) => Promise<void>;
  reload: () => Promise<void>;
}

const ConfigContext = createContext<ConfigContextValue | undefined>(undefined);

export const ConfigProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState<LoadedConfig>({ config: EMPTY_CONFIG, exists: false });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | undefined>();
  const [canEdit, setCanEdit] = useState(false);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(undefined);
    try {
      const loaded = await loadConfig();
      setState(loaded);
    } catch (e) {
      setError(e as Error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    void canWriteConfig().then(setCanEdit);
  }, [reload]);

  const save = useCallback(
    async (next: AppConfig) => {
      const { objectId, version } = await saveConfig(next, {
        objectId: state.objectId,
        version: state.version,
      });
      setState({ config: next, objectId, version, exists: true });
    },
    [state.objectId, state.version]
  );

  const value = useMemo<ConfigContextValue>(
    () => ({
      config: state.config,
      isLoading,
      error,
      configured: isConfigured(state.config),
      canEdit,
      save,
      reload,
    }),
    [state.config, isLoading, error, canEdit, save, reload]
  );

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
};

/** Access the environment configuration. Must be used inside <ConfigProvider>. */
export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useConfig must be used within a ConfigProvider");
  return ctx;
}
