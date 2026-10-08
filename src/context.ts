import { createContext, useContext, type RefObject } from "react";
import type { AppData, LogItem, Settings } from "@/lib/domain";
import type { useComposer } from "./today";
import type { Route } from "./ui";

/** The five tabs, plus 设置 ("me"), which opens from the gear and has no tab of its own. */
export type Tab = "today" | "diet" | "strength" | "body" | "weekly" | "me";
export type Actions = {
  edit: (item: LogItem) => void;
  undo: (ids: string[]) => Promise<void>;
  restore: (ids: string[]) => Promise<void>;
  reload: () => Promise<void>;
  /** Switches to 今天 and puts text in the input, cursor at the end. */
  compose: (text: string) => void;
  send: (text: string, images?: string[]) => Promise<boolean>;
  openTab: (tab: Tab, route?: Route) => void;
  saveSettings: (settings: Settings) => Promise<void>;
  action: (type: string, fields?: Record<string, unknown>) => Promise<{ message?: string }>;
  signOut: () => Promise<void>;
};
export type AppState = {
  data: AppData; date: string; setDate: (date: string) => void;
  draft: string; setDraft: (text: string) => void; inputRef: RefObject<HTMLTextAreaElement | null>;
  composer: ReturnType<typeof useComposer>; actions: Actions;
};
export const AppContext = createContext<AppState | null>(null);
export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp outside the signed-in shell");
  return value;
}
