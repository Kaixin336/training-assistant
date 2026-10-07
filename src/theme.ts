import { storageSet } from "./api";

export type ThemeChoice = "system" | "light" | "dark";

/** Keeps the iOS status bar / browser chrome the same colour as the page. */
export function syncThemeColor() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  if (bg) document.querySelectorAll('meta[name="theme-color"]').forEach(meta => meta.setAttribute("content", bg));
}

export function applyTheme(choice: ThemeChoice) {
  storageSet("kai-theme", choice);
  if (choice === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  syncThemeColor();
}

export function watchSystemTheme() {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncThemeColor);
  syncThemeColor();
}
