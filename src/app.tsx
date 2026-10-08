import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChartNoAxesColumn, Dumbbell, LoaderCircle, NotebookPen, PersonStanding, UtensilsCrossed } from "lucide-react";
import type { AppData, LogItem, Settings } from "@/lib/domain";
import { AUTH_LOST, api, postJson, storageGet, storageSet } from "./api";
import { AppContext, type Actions, type AppState, type Tab } from "./context";
import { EditSheet } from "./edit-sheet";
import { placesOf, TodayScreen, useComposer } from "./today";
import { NavContext, ToastProvider, useToast, type Route } from "./ui";
import { watchSystemTheme } from "./theme";

const DietScreen = lazy(() => import("./diet").then(m => ({ default: m.DietScreen })));
const PlanScreen = lazy(() => import("./diet").then(m => ({ default: m.PlanScreen })));
const StrengthList = lazy(() => import("./strength").then(m => ({ default: m.StrengthList })));
const ExerciseDetail = lazy(() => import("./strength").then(m => ({ default: m.ExerciseDetail })));
const WeeklyScreen = lazy(() => import("./weekly").then(m => ({ default: m.WeeklyScreen })));
const BodyScreen = lazy(() => import("./body").then(m => ({ default: m.BodyScreen })));
const MeasureDetail = lazy(() => import("./body").then(m => ({ default: m.MeasureDetail })));
const PhotosScreen = lazy(() => import("./body").then(m => ({ default: m.PhotosScreen })));
const settings = () => import("./settings");
const SettingsScreen = lazy(() => settings().then(m => ({ default: m.SettingsScreen })));
const PhaseScreen = lazy(() => settings().then(m => ({ default: m.PhaseScreen })));
const GoalsScreen = lazy(() => settings().then(m => ({ default: m.GoalsScreen })));
const AiScreen = lazy(() => settings().then(m => ({ default: m.AiScreen })));
const HealthScreen = lazy(() => settings().then(m => ({ default: m.HealthScreen })));
const DataScreen = lazy(() => settings().then(m => ({ default: m.DataScreen })));
const InstallScreen = lazy(() => settings().then(m => ({ default: m.InstallScreen })));

type Auth = "checking" | "signed-out" | "signed-in" | "unavailable";
export function App() {
  const [auth, setAuth] = useState<Auth>("checking");
  const [problem, setProblem] = useState("");
  const check = useCallback(() => {
    setAuth("checking");
    fetch("/api/session", { credentials: "same-origin", cache: "no-store" })
      .then(async response => {
        const body = await response.json().catch(() => ({})) as { authenticated?: boolean; error?: string };
        if (!response.ok) { setProblem(body.error || "服务暂时不可用。"); setAuth("unavailable"); return; }
        setAuth(body.authenticated ? "signed-in" : "signed-out");
      })
      .catch(() => { setProblem("连不上服务器，请检查网络。"); setAuth("unavailable"); });
  }, []);
  useEffect(() => {
    check(); watchSystemTheme();
    const lost = () => setAuth("signed-out");
    window.addEventListener(AUTH_LOST, lost);
    if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    return () => window.removeEventListener(AUTH_LOST, lost);
  }, [check]);
  if (auth === "checking") return <div className="center"><LoaderCircle className="spin" /></div>;
  if (auth === "unavailable") return <div className="center"><p>{problem}</p><button className="btn primary" onClick={check}>重试</button></div>;
  if (auth === "signed-out") return <Login onSignedIn={() => setAuth("signed-in")} />;
  return <ToastProvider><Shell onSignedOut={() => setAuth("signed-out")} /></ToastProvider>;
}

function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!password || busy) return;
    setBusy(true); setError("");
    try { await postJson("/api/login", { password: password.trim() }); onSignedIn(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "登录失败"); }
    finally { setBusy(false); }
  }
  return <form className="login" onSubmit={submit}>
    <img className="login-mark" src="/icons/icon-192.png" alt="" />
    <h1>训记</h1>
    <p>你的私人训练记录。</p>
    {/* The hidden username lets iCloud Keychain remember the passphrase for this site. */}
    <input type="text" name="username" autoComplete="username" value="me" readOnly hidden />
    <input className="input" type="password" name="password" autoComplete="current-password" placeholder="访问口令" aria-label="访问口令" value={password} onChange={e => setPassword(e.target.value)} autoFocus />
    {error && <p className="error" role="alert" style={{ marginTop: 10 }}>{error}</p>}
    <button className="btn primary block" disabled={busy || !password}>{busy ? <LoaderCircle className="spin" /> : "进入"}</button>
    <p className="footnote">登录会在这台设备保留 30 天。</p>
  </form>;
}

/* 今天 is where everything is recorded; the other tabs read the same data back, each answering one question. */
const tabs: { id: Exclude<Tab, "me">; label: string; Icon: typeof NotebookPen }[] = [
  { id: "today", label: "今天", Icon: NotebookPen },
  { id: "diet", label: "饮食", Icon: UtensilsCrossed },
  { id: "strength", label: "力量", Icon: Dumbbell },
  { id: "body", label: "身体", Icon: PersonStanding },
  { id: "weekly", label: "周报", Icon: ChartNoAxesColumn },
];
const roots: Record<Tab, Route> = { today: { screen: "today" }, diet: { screen: "diet" }, strength: { screen: "list" }, body: { screen: "body" }, weekly: { screen: "weekly" }, me: { screen: "settings" } };
const initialStacks = () => Object.fromEntries(Object.entries(roots).map(([id, root]) => [id, [root]])) as Record<Tab, Route[]>;

function Shell({ onSignedOut }: { onSignedOut: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<AppData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab>(() => { const saved = storageGet("kai-tab"); return tabs.some(t => t.id === saved) ? saved as Tab : "today"; });
  const [stacks, setStacks] = useState(initialStacks);
  const [date, setDate] = useState("");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<LogItem | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const operationIds = useRef(new Map<string, string>());

  const known = useRef<AppData | null>(null);
  const reload = useCallback(async () => {
    // Coming back to the app: ask whether anything changed first (one row) instead of re-reading everything.
    const last = known.current;
    const query = last?.version && !last.activeSession ? `?v=${encodeURIComponent(last.version)}&today=${last.today}` : "";
    const next = await api<AppData | { unchanged: true }>(`/api/data${query}`);
    if ("unchanged" in next) { setLoadError(""); return; }
    known.current = next;
    setData(next); setLoadError("");
    setDate(current => !current || current > next.today ? next.today : current);
  }, []);
  useEffect(() => {
    reload().catch(e => setLoadError(e.message));
    const visible = () => { if (document.visibilityState === "visible") reload().catch(() => {}); };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [reload]);

  /* Navigation with scroll restoration per route. */
  const route = stacks[tab].at(-1)!;
  const routeKey = `${tab}:${stacks[tab].length}:${route.screen}:${JSON.stringify(route.params ?? {})}`;
  useLayoutEffect(() => { window.scrollTo(0, route.scroll ?? 0); }, [routeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const remember = (stack: Route[]) => stack.map((r, i) => i === stack.length - 1 ? { ...r, scroll: window.scrollY } : r);
  // 设置 is entered from the gear and left with 返回 to wherever it was opened from.
  const settingsFrom = useRef<Tab>("today");
  const openTab = useCallback((next: Tab, to?: Route) => {
    setStacks(s => {
      const saved = { ...s, [tab]: remember(s[tab]) };
      if (!to) return saved;
      const rootRoute = roots[next];
      return { ...saved, [next]: to.screen === rootRoute.screen ? [rootRoute] : [rootRoute, { ...to, scroll: 0 }] };
    });
    if (next === "me" && tab !== "me") settingsFrom.current = tab;
    setTab(next); if (next !== "me") storageSet("kai-tab", next);
  }, [tab]);
  const atRoot = stacks[tab].length <= 1;
  const nav = useMemo(() => ({
    push: (next: Route) => setStacks(s => ({ ...s, [tab]: [...remember(s[tab]), { ...next, scroll: 0 }] })),
    pop: () => tab === "me" && atRoot ? setTab(settingsFrom.current) : setStacks(s => ({ ...s, [tab]: s[tab].length > 1 ? s[tab].slice(0, -1) : s[tab] })),
    settings: () => openTab("me", roots.me),
  }), [tab, atRoot, openTab]);
  const selectTab = (next: Tab) => {
    if (next === tab) { if (stacks[tab].length > 1) setStacks(s => ({ ...s, [tab]: [s[tab][0]] })); else window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    openTab(next);
  };

  /** Retrying the same action reuses one operation ID, so a lost response never applies twice. */
  const action = useCallback(async (type: string, fields: Record<string, unknown> = {}) => {
    const key = JSON.stringify({ type, ...fields });
    const operationId = operationIds.current.get(key) ?? crypto.randomUUID();
    operationIds.current.set(key, operationId);
    const result = await postJson<{ message?: string }>("/api/action", { operationId, type, ...fields });
    operationIds.current.delete(key);
    await reload().catch(() => toast("已保存，刷新失败"));
    return result;
  }, [reload, toast]);
  const restore = useCallback(async (ids: string[]) => { try { for (const id of ids) await postJson("/api/action", { operationId: crypto.randomUUID(), type: "restore", id }); await reload(); toast("已恢复"); } catch (e) { toast(e instanceof Error ? e.message : "恢复失败"); } }, [reload, toast]);
  const undo = useCallback(async (ids: string[]) => {
    try {
      for (const id of ids) await postJson("/api/action", { operationId: crypto.randomUUID(), type: "undo", id });
      await reload();
      toast(ids.length > 1 ? `已撤销 ${ids.length} 条` : "已撤销", { label: "恢复", run: () => void restore(ids) });
    } catch (e) { toast(e instanceof Error ? e.message : "撤销失败"); }
  }, [reload, restore, toast]);

  // Must keep a stable identity: the composer's effects depend on it, and a fresh object each render
  // made every reload trigger another reload (an endless /api/data loop).
  const placed = useCallback((ids: string[]) => placesOf((known.current?.items ?? []).filter(i => ids.includes(i.id))), []);
  const composerActions = useMemo(() => ({ undo, reload, placed }), [undo, reload, placed]);
  const composer = useComposer(data ?? emptyData, date || data?.today || "", composerActions);
  const compose = useCallback((text: string) => {
    openTab("today"); setDraft(text);
    setTimeout(() => { const box = inputRef.current; if (box) { box.focus(); box.setSelectionRange(text.length, text.length); } }, 60);
  }, [openTab]);
  const actions: Actions = {
    edit: setEditing, undo, restore, reload, compose, openTab, action,
    send: composer.send,
    saveSettings: async (settings: Settings) => { const r = await action("settings", { settings }); toast(r.message ?? "已保存"); },
    signOut: async () => { try { await postJson("/api/logout", {}); } catch { /* Cookie expires anyway. */ } onSignedOut(); },
  };

  if (!data) return <div className="center">{loadError ? <><p>{loadError}</p><button className="btn primary" onClick={() => reload().catch(e => setLoadError(e.message))}>重试</button></> : <LoaderCircle className="spin" />}</div>;
  const state: AppState = { data, date: date || data.today, setDate, draft, setDraft, inputRef, composer, actions };
  return <AppContext.Provider value={state}>
    <NavContext.Provider value={nav}>
      <div className={`app tab-${tab}`}>
        <Suspense fallback={<div className="center"><LoaderCircle className="spin" /></div>}>{renderRoute(tab, route)}</Suspense>
        <nav className="tabbar" aria-label="主导航"><div className="tabbar-inner">
          {tabs.map(({ id, label, Icon }) => <button key={id} className={`tab${tab === id ? " active" : ""}`} aria-current={tab === id ? "page" : undefined} onClick={() => selectTab(id)}><Icon /><span>{label}</span></button>)}
        </div></nav>
      </div>
      {editing && <EditSheet key={editing.id} item={editing} onClose={() => setEditing(null)} onSave={async item => { await action("edit", { id: item.id, item }); toast("已更新"); }} onUndo={() => void undo([editing.id])} />}
    </NavContext.Provider>
  </AppContext.Provider>;
}

const emptyData: AppData = { settings: { phase: "unspecified", phaseStart: null, calorieTarget: null, proteinMin: null, proteinMax: null, stepTarget: null, sleepMin: null, weightGoal: null, hipsGoal: null, waistGoal: null, blockStart: "2026-10-05", swimMonth: 0 }, plan: [], planVersion: 0, items: [], changes: [], messages: [], aiEnabled: false, today: "2026-01-01" };

function renderRoute(tab: Tab, route: Route) {
  const p = route.params ?? {};
  switch (`${tab}:${route.screen}`) {
    case "today:today": return <TodayScreen />;
    case "diet:diet": return <DietScreen />;
    case "diet:plan": return <PlanScreen />;
    case "strength:list": return <StrengthList />;
    case "strength:exercise": return <ExerciseDetail key={p.id} id={p.id} />;
    case "weekly:weekly": return <WeeklyScreen />;
    case "body:body": return <BodyScreen />;
    case "body:measure": return <MeasureDetail metric={p.metric as "waist"} />;
    case "body:photos": return <PhotosScreen />;
    case "me:settings": return <SettingsScreen />;
    case "me:phase": return <PhaseScreen />;
    case "me:goals": return <GoalsScreen />;
    case "me:ai": return <AiScreen />;
    case "me:health": return <HealthScreen />;
    case "me:data": return <DataScreen />;
    case "me:install": return <InstallScreen />;
    default: return <TodayScreen />;
  }
}
