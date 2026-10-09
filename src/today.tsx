import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronDown, ChevronLeft, ChevronRight, ImagePlus, LoaderCircle, MessagesSquare, Plus, RefreshCw, X } from "lucide-react";
import { addDays, itemSummary, todayNZ, weekStart, type AppData, type ChatMessage, type LogItem, type Workout } from "@/lib/domain";
import { postJson, storageGet, storageSet } from "./api";
import { useApp, type Actions } from "./context";
import { feelText, kindLabels, phaseLabels, unitTags } from "./labels";
import { dayExercises, dayLabel, fmt, formatLoad, LOADED, phaseWeek, primaryMeasure, sessionValue, setText, signed, weekday, type DayExercise } from "./metrics";
import { DayTypeToggle, DietLink, exerciseTarget, planCheckIns, ReadinessCard, runHealthSync, TodayStrip } from "./plan-ui";
import { isPlanned } from "@/lib/diet";
import { Empty, FoldSection, Screen, Section, Sheet, useNow, useToast } from "./ui";

const FINISH = /^(?:结束训练|训练结束|结束本次训练|今天练完了|练完了)[。.!！]?$/;
const DATED = /^\s*(?:\d{4}-\d{2}-\d{2}|今天|昨天|前天|yesterday|today)/i;

export function TodayScreen() {
  const { data, date, setDate } = useApp();
  const [log, setLog] = useState(false);
  const isToday = date === data.today;
  const week = phaseWeek(data);
  return <Screen root composer title={isToday ? "今天" : dayLabel(date)}
    kicker={<><DayTypeToggle date={date} />{weekday(date)}{data.settings.phase !== "unspecified" ? ` · ${phaseLabels[data.settings.phase].replace("期", "")}第 ${week ?? 1} 周` : ""}</>}
    right={<>{!isToday && <button className="text-btn strong" onClick={() => setDate(data.today)}>今天</button>}<button className="icon-btn" aria-label="立即同步健康数据" onClick={runHealthSync}><RefreshCw /></button><button className="icon-btn" aria-label="对话记录" onClick={() => setLog(true)}><MessagesSquare /></button></>}>
    <WeekStrip />
    <TodayStrip date={date} />
    {isToday && <ReadinessCard />}
    {isToday && data.activeSession && <LiveSession />}
    {isToday && <CheckIns />}
    <DayLog />
    <Composer />
    <ChatLog open={log} onClose={() => setLog(false)} messages={data.messages} />
  </Screen>;
}

function WeekStrip() {
  const { data, date, setDate } = useApp();
  const monday = weekStart(date);
  const trained = new Set(data.items.filter(i => i.kind === "workout").map(i => i.date));
  const logged = new Set(data.items.filter(i => !isPlanned(i)).map(i => i.date));
  return <div className="week" role="group" aria-label="选择日期">
    <button className="week-nav" aria-label="上一周" onClick={() => setDate(addDays(date, -7))}><ChevronLeft /></button>
    {Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map(day => <button key={day} disabled={day > data.today} aria-pressed={day === date} aria-label={`${dayLabel(day)} ${weekday(day)}`}
      className={`day${day === date ? " selected" : ""}${day === data.today ? " today" : ""}${trained.has(day) ? " trained" : logged.has(day) ? " logged" : ""}`} onClick={() => setDate(day)}>
      <span className="day-name">{weekday(day).slice(1)}</span><span className="day-num">{Number(day.slice(8))}</span><span className="day-dot" />
    </button>)}
    <button className="week-nav" aria-label="下一周" disabled={addDays(monday, 7) > data.today} onClick={() => setDate(addDays(date, 7) > data.today ? data.today : addDays(date, 7))}><ChevronRight /></button>
  </div>;
}

function LiveSession() {
  const { data, actions } = useApp();
  const session = data.activeSession!;
  const now = useNow();
  const workouts = data.items.filter((i): i is Workout => i.kind === "workout" && i.trainingSessionId === session.id);
  const sets = workouts.reduce((n, w) => n + w.sets.filter(s => !s.isWarmup).length, 0);
  const exercises = new Set(workouts.map(w => w.exerciseId)).size;
  const elapsed = Math.round((now - Date.parse(session.startedAt)) / 60000);
  return <div className="live" role="status">
    <span className="live-dot" />
    <div className="live-main">
      <div className="live-title">训练中 · {elapsed} 分钟</div>
      <div className="live-sub">{session.activeExerciseName ?? ""}{session.activeExerciseName ? " · " : ""}{exercises} 个动作 {sets} 组</div>
    </div>
    <button className="live-end" onClick={() => actions.send("结束训练")}>结束</button>
  </div>;
}

function CheckIns() {
  const { data } = useApp();
  const due = planCheckIns(data);
  if (!due.length) return null;
  return <div className="chips checkins">{due.map(d => <button key={d.key} className="chip" onClick={runHealthSync}><span className="dot" />{d.label}</button>)}</div>;
}

function DayLog() {
  const { data, date, actions } = useApp();
  const items = data.items.filter(i => i.date === date);
  const exercises = dayExercises(data.items, date).filter(e => e.rows.length > 0);
  const cardio = items.filter((i): i is Workout => i.kind === "workout" && i.sets.length === 0);
  const body = items.filter(i => i.kind === "metric" && i.metric !== "weight" && i.metric !== "waist");
  // Sleep and steps are on the number strip; only other recovery values (HRV, resting heart rate…) are listed.
  const recovery = items.filter(i => i.kind === "health" && Object.entries(i).some(([key, value]) => !["steps", "sleepH", "creatineTaken", "creatineG"].includes(key) && typeof value === "number"));
  const notes = items.filter(i => i.kind === "note");
  const photos = items.filter(i => i.kind === "photo");
  const workingSets = exercises.reduce((n, e) => n + e.rows.filter(r => !r.set.isWarmup).length, 0);
  // The exercise logged to most recently is the one in progress: it stays open while earlier ones fold away.
  const lastLogged = (e: DayExercise) => e.records.reduce((t, r) => r.createdAt > t ? r.createdAt : t, "");
  const currentKey = exercises.reduce<DayExercise | null>((a, e) => !a || lastLogged(e) > lastLogged(a) ? e : a, null)?.key;
  const real = items.filter(i => !isPlanned(i));
  if (!real.length && !items.length) return data.items.some(i => !isPlanned(i)) ? <Empty title={date === data.today ? "今天还没有记录" : "这一天没有记录"}>在下方输入，例如 <code>卧推 60kg 3x8</code></Empty> : <FirstRun />;
  const entry = (item: LogItem, value?: string, sub?: string) => <button key={item.id} className="entry" onClick={() => actions.edit(item)}>
    <span className="entry-main">{value ? (item.kind === "food" ? item.description : kindLabels[item.kind]) : itemSummary(item)}{sub && <span className="entry-sub">{sub}</span>}</span>
    {value && <span className="entry-value">{value}</span>}
  </button>;
  return <>
    {exercises.length > 0 && <FoldSection id="training" title="训练" meta={`${exercises.length} 个动作 · ${workingSets} 组`} note={trainingNote(exercises, data.settings.phase)}>{exercises.map(e => <ExerciseBlock key={e.key} exercise={e} current={e.key === currentKey} />)}</FoldSection>}
    {cardio.length > 0 && <Section title="运动">{cardio.map(w => entry(w, undefined, w.id.startsWith("health-") ? "来自 Apple 健康" : w.session === "Apple Watch" ? "来自截图" : undefined))}</Section>}
    <DietLink date={date} />
    {body.length > 0 && <Section title="身体">{body.map(m => entry(m, undefined, m.id.startsWith("health-") ? "来自健康" : undefined))}</Section>}
    {recovery.length > 0 && <FoldSection id="health" title="健康数据" defaultOpen={false} summary={recovery.map(itemSummary).join(" · ")}>{recovery.map(h => entry(h, undefined, h.id.startsWith("health-") ? "来自健康" : undefined))}</FoldSection>}
    {notes.length > 0 && <Section title="备注">{notes.map(n => entry(n, undefined, n.kind === "note" && n.category === "pain" ? "疼痛" : undefined))}</Section>}
    {photos.length > 0 && <Section title="照片"><button className="entry" onClick={() => actions.openTab("body", { screen: "photos" })}><span className="entry-main">这天拍了 {photos.length} 张</span><span className="entry-value"><ChevronRight size={16} /></span></button></Section>}
  </>;
}

/** Weight × reps over the working sets, as entered (per side / per hand for those exercises). Not for assisted or bodyweight work. */
function exerciseVolume(exercise: DayExercise) {
  if (!LOADED.has(exercise.unit)) return null;
  const merged: Workout = { ...exercise.records[0], sets: exercise.rows.map(r => r.set) };
  return sessionValue(merged, "volume");
}

/**
 * The day's training in one short line: total weight, then a verdict from each exercise against its last session
 * (pain first, then drops, then gains). In a cut, holding strength counts as a win.
 */
function trainingNote(exercises: DayExercise[], phase: string) {
  const total = exercises.reduce((n, e) => n + (exerciseVolume(e) ?? 0), 0);
  const rows = exercises.map(e => {
    const measure = primaryMeasure(e.unit), merged: Workout = { ...e.records[0], sets: e.rows.map(r => r.set) };
    const now = sessionValue(merged, measure), before = e.previous ? sessionValue(e.previous, measure) : null;
    return { name: e.name, change: now !== null && before ? now / before - 1 : null, pain: e.records.some(r => r.pain) };
  });
  const names = (list: typeof rows) => list.slice(0, 2).map(r => r.name).join("、") + (list.length > 2 ? ` 等 ${list.length} 个动作` : "");
  const compared = rows.filter(r => r.change !== null);
  const up = compared.filter(r => r.change! > .01), down = compared.filter(r => r.change! < -.03);
  const cutting = phase === "fat_loss";
  const pain = rows.filter(r => r.pain);
  const verdict = pain.length ? `${names(pain)}有疼痛，下次先别加重`
    : down.length ? `${names(down)}比上次弱一点，留意睡眠和吃够${up.length ? `；${names(up)}还在涨` : ""}`
    : up.length ? `${names(up)}比上次更强${cutting ? "，减脂期还在进步，练得很扎实" : up.length < compared.length ? "，其余持平" : "，状态在线"}`
    : compared.length ? (cutting ? "和上次持平，减脂期守住力量就是胜利" : "和上次持平，下次试着多做一次")
    : "都是第一次记录的动作，下次会和今天比";
  return `${total ? `总重量 ${Math.round(total).toLocaleString("zh-CN")} kg · ` : ""}${verdict}。`;
}

// Folding chosen by hand, per day and exercise; kept while switching tabs.
const folded = new Map<string, boolean>();

function ExerciseBlock({ exercise, current }: { exercise: DayExercise; current: boolean }) {
  const { data, date, actions } = useApp();
  const foldKey = `${date}|${exercise.key}`;
  // Long exercises fold by default unless they are the one in progress; a tap overrides either way.
  const [open, setOpen] = useState(() => folded.get(foldKey) ?? (current || exercise.rows.length <= 3));
  const toggle = () => { folded.set(foldKey, !open); setOpen(!open); };
  // Moving on to the next exercise folds this one (and coming back opens it), unless it was set by hand.
  useEffect(() => { if (!folded.has(foldKey)) setOpen(current || exercise.rows.length <= 3); }, [current, foldKey, exercise.rows.length]);
  const target = exerciseTarget(data.items, exercise.id, date, exercise.unit, data.settings);
  const { name, unit, rows, previous } = exercise;
  const previousSets = previous ? previous.sets.filter(s => !s.isWarmup) : [];
  const pain = exercise.records.some(r => r.pain);
  const measure = primaryMeasure(unit);
  const merged: Workout = { ...exercise.records[0], sets: rows.map(r => r.set) };
  const value = sessionValue(merged, measure), before = previous ? sessionValue(previous, measure) : null;
  const lastLoaded = [...rows].reverse().find(r => !r.set.isWarmup && r.set.weightKg !== null)?.set.weightKg;
  const loadPrefix = lastLoaded == null ? "" : unit === "kg/side" ? `每边${lastLoaded}kg ` : unit === "kg/hand" ? `单手${lastLoaded}kg ` : unit === "added kg" ? `加重${lastLoaded}kg ` : unit === "assisted kg" ? `辅助${lastLoaded}kg ` : unit === "kg" ? `${lastLoaded}kg ` : "";
  let n = 0;
  const working = rows.filter(r => !r.set.isWarmup).map(r => r.set);
  const top = [...working].sort((a, b) => (b.weightKg ?? 0) - (a.weightKg ?? 0) || (b.reps ?? 0) - (a.reps ?? 0))[0];
  const valueText = value !== null ? `${measure === "reps" ? "总次数" : "1RM"} ${fmt(value, measure === "reps" ? 0 : 1)}` : "";
  const volume = exerciseVolume(exercise);
  const volumeText = volume ? `总重 ${Math.round(volume).toLocaleString("zh-CN")} kg` : "";
  const summary = [`${working.length} 组`, top ? `最重 ${setText(top, unit)}` : "", valueText, volumeText].filter(Boolean).join(" · ");
  return <div className={`exercise${open ? "" : " folded"}`}>
    <div className="exercise-head">
      <button className="exercise-toggle" onClick={toggle} aria-expanded={open} aria-label={`${open ? "收起" : "展开"}${name}`}>
        <ChevronDown className="fold-chev" />
        <span className="exercise-name">{name}</span>
        {unitTags[unit] && <span className="tag">{unitTags[unit]}</span>}
        {pain && <span className="tag hot">疼痛</span>}
        {!open && <span className="exercise-summary">{summary}</span>}
      </button>
      {exercise.id && <button className="exercise-more" aria-label={`${name}的历史和曲线`} onClick={() => actions.openTab("strength", { screen: "exercise", params: { id: exercise.id! } })}><ChevronRight className="row-chev" /></button>}
    </div>
    {open && <>
    {target && <div className={`target ${target.tone}`}><span>目标</span>{target.text}</div>}
    <div className="set-grid set-head" aria-hidden="true"><span>组</span><span>上次</span><span>重量</span><span>次数</span><span /></div>
    {rows.map(({ set, record, index }) => {
      const number = set.isWarmup ? null : ++n;
      const prior = number ? previousSets[number - 1] : undefined;
      const reps = set.reps ?? (set.durationSec !== null ? `${set.durationSec}秒` : set.distanceM !== null ? `${set.distanceM}米` : "—");
      return <button key={`${record.id}-${index}`} className={`set-grid set-row${set.isWarmup ? " warmup" : ""}`} onClick={() => actions.edit(record)} aria-label={`编辑${name}${number ? `第${number}组` : "热身组"}`}>
        <span className="set-idx">{number ?? "热"}</span>
        <span className="set-prev">{prior ? setText(prior, unit) : "—"}</span>
        <span className="set-load">{formatLoad(set.weightKg, unit)}{set.weightKg !== null && <small>kg</small>}</span>
        <span className="set-reps">{reps}{typeof reps === "number" && <small>次</small>}</span>
        <span className={`set-feel ${set.feel ?? ""}`}>{set.feel ? feelText[set.feel] : set.side !== "both" ? (set.side === "left" ? "左" : "右") : ""}</span>
      </button>;
    })}
    <div className="exercise-foot">
      <span>{[valueText && before !== null ? `${valueText} · 比上次 ${signed(value! - before, measure === "reps" ? 0 : 1)}` : valueText, volumeText].filter(Boolean).join(" · ")}</span>
      <button className="add-set" onClick={() => actions.compose(`${name} ${loadPrefix}`)}><Plus />一组</button>
    </div>
    </>}
  </div>;
}

function FirstRun() {
  const { data, actions } = useApp();
  const examples = data.aiEnabled
    ? ["今天练胸，卧推 60 做了 3 组 8 个，最后一组很吃力", "体重 72.4，昨晚睡了 7 个半小时", "午饭鸡胸肉米饭，大概 45 克蛋白"]
    : ["卧推 60kg 3x8 吃力", "体重 72.4，睡眠 7.5小时", "午餐：鸡胸肉米饭 650kcal 45g蛋白质"];
  return <Empty title="从第一组开始">
    练完或者练的间隙，用一句话告诉我做了什么。我会整理成训练记录，下次会显示上次的重量和次数。
    <div className="suggestions">{examples.map(text => <button key={text} className="suggestion" onClick={() => actions.compose(text)}><span>{text}</span><ArrowUp /></button>)}</div>
  </Empty>;
}

/* ── Composer with offline outbox ─────────────────────────────────────── */
type Queued = { id: string; text: string; composeDate: string };
const OUTBOX = "kai-outbox";
const readOutbox = (): Queued[] => { try { return JSON.parse(storageGet(OUTBOX) || "[]"); } catch { return []; } };
const writeOutbox = (rows: Queued[]) => storageSet(OUTBOX, JSON.stringify(rows));
type Reply = { kind: "ask" | "answer" | "info" | "error"; text: string; pendingId?: string };

/** Where a saved record shows up, so the toast can say “已记到饮食” instead of just a count. */
export function placesOf(items: LogItem[]) {
  const place = (i: LogItem) => i.kind === "workout" ? (i.sets.length ? "训练" : "运动") : i.kind === "food" ? "饮食" : i.kind === "metric" ? "身体" : i.kind === "health" ? "恢复" : i.kind === "photo" ? "照片" : "备注";
  return [...new Set(items.map(place))];
}

/** Created once in the shell so a pending reply or outbox survives switching tabs. */
export function useComposer(data: AppData, date: string, actions: Pick<Actions, "undo" | "reload"> & { placed: (ids: string[]) => string[] }) {
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);
  const [outbox, setOutbox] = useState<Queued[]>(readOutbox);
  const identity = useRef<{ text: string; id: string } | null>(null);
  const flushing = useRef(false);

  /** Shows the reply; returns the IDs of what was saved so the caller can confirm it after the refresh. */
  const handle = useCallback((assistant: ChatMessage | undefined): string[] => {
    if (!assistant) return [];
    const extra = assistant.text.split("\n").filter(line => line && line !== "已记录：" && !line.startsWith("•")).join("\n");
    if (assistant.itemIds?.length) { setReply(extra ? { kind: "info", text: extra } : null); return assistant.itemIds; }
    if (assistant.clarification) setReply({ kind: "ask", text: assistant.text, pendingId: assistant.id });
    else setReply({ kind: "answer", text: assistant.text });
    return [];
  }, []);
  const saved = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const places = actions.placed(ids);
    toast(places.length ? `已记到${places.join("、")}` : `已记录 ${ids.length} 条`, { label: "撤销", run: () => void actions.undo(ids) });
  }, [actions, toast]);

  const flush = useCallback(async () => {
    if (flushing.current || !navigator.onLine) return;
    const queued = readOutbox();
    if (!queued.length) return;
    flushing.current = true;
    const sent: string[] = [];
    try {
      for (const item of queued) {
        // A message written yesterday but sent today must still land on yesterday.
        const text = item.composeDate !== todayNZ() && !DATED.test(item.text) && !FINISH.test(item.text) ? `${item.composeDate} ${item.text}` : item.text;
        try {
          const result = await postJson<{ messages: ChatMessage[] }>("/api/chat", { id: item.id, text, pendingMessageId: null });
          sent.push(...handle(result.messages[1]));
        } catch (cause) {
          if (cause instanceof TypeError) break;
          setReply({ kind: "error", text: `一条离线记录没能保存：${cause instanceof Error ? cause.message : "未知错误"}\n原文：${item.text}` });
        }
        const rest = readOutbox().filter(q => q.id !== item.id); writeOutbox(rest); setOutbox(rest);
      }
      await actions.reload().then(() => saved(sent)).catch(() => {});
    } finally { flushing.current = false; }
  }, [actions, handle, saved]);

  useEffect(() => {
    void flush();
    const online = () => void flush();
    const visible = () => { if (document.visibilityState === "visible") void flush(); };
    window.addEventListener("online", online); document.addEventListener("visibilitychange", visible);
    return () => { window.removeEventListener("online", online); document.removeEventListener("visibilitychange", visible); };
  }, [flush]);

  const send = useCallback(async (raw: string, images: string[] = []): Promise<boolean> => {
    const base = raw.trim(); if ((!base && !images.length) || sending) return false;
    const text = date !== data.today && !DATED.test(base) && !FINISH.test(base) ? `${date} ${base}`.trim() : base;
    const key = `${text}|${images.length}|${images.map(i => i.length).join(",")}`;
    if (!identity.current || identity.current.text !== key) identity.current = { id: crypto.randomUUID(), text: key };
    const id = identity.current.id;
    setSending(true);
    try {
      const result = await postJson<{ messages: ChatMessage[] }>("/api/chat", { id, text, ...(images.length ? { images } : {}), pendingMessageId: reply?.kind === "ask" ? reply.pendingId : null });
      identity.current = null;
      const ids = handle(result.messages[1]);
      await actions.reload().then(() => saved(ids), () => toast("已保存，但刷新失败，稍后会自动更新"));
      return true;
    } catch (cause) {
      if (cause instanceof TypeError && images.length) {
        setReply({ kind: "error", text: "没有网络。照片要联网才能识别，联网后再发一次。" });
        return false;
      }
      if (cause instanceof TypeError) {
        const rows = [...readOutbox().filter(q => q.id !== id), { id, text, composeDate: data.today }];
        writeOutbox(rows); setOutbox(rows); identity.current = null;
        toast("没有网络，已存为待发送");
        return true;
      }
      setReply({ kind: "error", text: cause instanceof Error ? cause.message : "发送失败，文字已保留。" });
      return false;
    } finally { setSending(false); }
  }, [actions, data.today, date, handle, reply, saved, sending, toast]);

  return { send, sending, reply, setReply, outbox, flush };
}

// The model reads a photo fine at about 1600px; shrinking on the phone keeps uploads small and fast.
async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", .82);
  } finally { URL.revokeObjectURL(url); }
}
const MAX_PHOTOS = 3;

function Composer() {
  const { data, date, draft, setDraft, composer, inputRef } = useApp();
  const { send, sending, reply, setReply, outbox, flush } = composer;
  const [photos, setPhotos] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const box = inputRef.current; if (!box) return;
    box.style.height = "auto"; box.style.height = `${Math.min(box.scrollHeight, 140)}px`;
  }, [draft, inputRef]);
  const submit = async () => { if (await send(draft, photos)) { setDraft(""); setPhotos([]); } };
  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setReading(true);
    try {
      const added = await Promise.all([...files].slice(0, MAX_PHOTOS - photos.length).map(shrinkPhoto));
      setPhotos(current => [...current, ...added].slice(0, MAX_PHOTOS));
    } catch { setReply({ kind: "error", text: "这张照片读不出来，换一张试试。" }); }
    finally { setReading(false); if (picker.current) picker.current.value = ""; }
  }
  const label = reply?.kind === "ask" ? "需要确认" : reply?.kind === "error" ? "没有保存" : reply?.kind === "info" ? "提示" : "回答";
  return <div className="composer">
    <div className="composer-inner">
      {reply && <div className={`reply ${reply.kind}`} role={reply.kind === "error" || reply.kind === "ask" ? "alert" : "status"}>
        <span className="reply-label">{label}</span>{reply.text}
        {reply.kind === "ask" && <div className="reply-actions"><button onClick={() => setReply(null)}>放弃这条</button></div>}
        <button className="reply-close" aria-label="关闭" onClick={() => setReply(null)}><X /></button>
      </div>}
      {(date !== data.today || outbox.length > 0) && <div className="composer-meta">
        <span>{outbox.length > 0 ? `${outbox.length} 条待发送 · 联网后自动发送` : `记到 ${dayLabel(date)}`}</span>
        {outbox.length > 0 && <button onClick={() => void flush()}>重试</button>}
      </div>}
      {photos.length > 0 && <div className="shots">{photos.map((src, index) => <div key={index} className="shot">
        <img src={src} alt={`照片 ${index + 1}`} />
        <button type="button" aria-label="移除照片" onClick={() => setPhotos(current => current.filter((_, i) => i !== index))}><X /></button>
      </div>)}</div>}
      <form className="pill" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <button type="button" className="attach" aria-label="添加照片" disabled={sending || reading || photos.length >= MAX_PHOTOS} onClick={() => picker.current?.click()}>{reading ? <LoaderCircle className="spin" /> : <ImagePlus />}</button>
        <input ref={picker} type="file" accept="image/*" multiple hidden onChange={event => void addPhotos(event.target.files)} />
        <textarea ref={inputRef} rows={1} value={draft} maxLength={12000} aria-label="记录训练、饮食或提问"
          placeholder={reply?.kind === "ask" ? "回答上面的问题…" : photos.length ? "补充说明（可不写）" : data.activeSession ? "又一组 8次…" : "记一笔，或拍照…"}
          onChange={event => setDraft(event.target.value)} enterKeyHint="send"
          onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} />
        {draft && !sending && <button type="button" className="clear" aria-label="清除输入" onClick={() => { setDraft(""); inputRef.current?.focus(); }}><X /></button>}
        <button className="send" aria-label="发送" disabled={sending || reading || (!draft.trim() && !photos.length)}>{sending ? <LoaderCircle className="spin" /> : <ArrowUp />}</button>
      </form>
    </div>
  </div>;
}

function ChatLog({ open, onClose, messages }: { open: boolean; onClose: () => void; messages: ChatMessage[] }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) setTimeout(() => end.current?.scrollIntoView({ block: "end" }), 50); }, [open]);
  const time = (iso: string) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Pacific/Auckland", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  return <Sheet open={open} onClose={onClose} title="对话记录" tall left={<span />} right={<button className="text-btn strong" onClick={onClose}>完成</button>}>
    {messages.length ? <div className="thread">{messages.map(m => <div key={m.id} className={`bubble ${m.role}`}><time>{time(m.createdAt)}</time>{m.text}</div>)}<div ref={end} /></div>
      : <p className="sheet-desc">还没有对话。</p>}
  </Sheet>;
}
