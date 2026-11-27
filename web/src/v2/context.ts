import { createContext, useContext, useEffect } from "react";
import { useApi } from "../api";

export type PageHead = { title?: string; summary?: string };

export type Shared = {
  setHead: (head: PageHead) => void;
  /** Changes when synced or owner-entered data changes. */
  version: string;
  /** Call after saving owner records so every view reloads. */
  changed: () => void;
  openAgent: (code: string) => void;
  notify: (message: string) => void;
};

export const SharedContext = createContext<Shared>({
  setHead: () => {},
  version: "",
  changed: () => {},
  openAgent: () => {},
  notify: () => {},
});
export const useShared = () => useContext(SharedContext);

/** Sets the Fraunces title and italic summary in the shared page header. */
export function useHead(title?: string, summary?: string) {
  const { setHead } = useShared();
  useEffect(() => {
    setHead({ title, summary });
    return () => setHead({});
  }, [setHead, title, summary]);
}

/**
 * Loads a V2 view and refreshes it in place after a sync or a save, keeping the
 * current data on screen while the new data loads.
 */
export function useView<T>(path: string) {
  const { version } = useShared();
  const result = useApi<T>(path);
  const { reload } = result;
  useEffect(() => {
    if (version) reload();
  }, [version, reload]);
  return result;
}
