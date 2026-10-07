import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronLeft, ChevronRight, ImagePlus, LoaderCircle, MessagesSquare, Plus, X } from "lucide-react";
import { addDays, dailyTotals, itemSummary, todayNZ, weekStart, type AppData, type ChatMessage, type Food, type LogItem, type Workout } from "@/lib/domain";
import { postJson, storageGet, storageSet } from "./api";
import { useApp, type Actions } from "./context";
import { feelText, kindLabels, phaseLabels, unitTags } from "./labels";
import { dayExercises, dayLabel, fmt, formatLoad, phaseWeek, primaryMeasure, sessionValue, setText, signed, weekday, type DayExercise } from "./metrics";
import { DayTypeToggle, exerciseTarget, MealsSection, planCheckIns, ReadinessCard } from "./plan-ui";
import { isPlanned } from "@/lib/diet";
import { Empty, Screen, Section, Sheet, useNow, useToast } from "./ui";

const FINISH = /^(?:结束训练|训练结束|结束本次训练|今天练完了|练完了)[。.!！]?$/;
const DATED = /^\s*(?:\d{4}-\d{2}-\d{2}|今天|昨天|前天|yesterday|today)/i;

export function TodayScreen() {
  const { data, date, setDate } = useApp();
  const [log, setLog] = useState(false);
  const isToday = date === data.today;
  const week = phaseWeek(data);
  return <Screen root composer title={isToday ? "今天" : dayLabel(date)}
    kicker={<><DayTypeToggle date={date} /><span className={`phase-dot ${data.settings.phase}`} />{weekday(date)} · {phaseLabels[data.settings.phase]}{week ? ` 第 ${week} 周` : ""}</>}
    right={<>{!isToday && <button className="text-btn strong" onClick={() => setDate(data.today)}>今天</button>}<button className="icon-btn" aria-label="对话记录" onClick={() => setLog(true)}><MessagesSquare /></button></>}>
    <WeekStrip />
    <Stats />
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

function Stats() {
  const { data, date, actions } = useApp();
  const day = dailyTotals(data.items, date);
  const cells = [
    { label: "体重", value: day.weight === null ? null : fmt(day.weight, 1), unit: "kg", prefill: "体重 " },
    { label: "睡眠", value: day.sleep === null ? null : fmt(day.sleep, 1), unit: "小时", prefill: "睡眠 " },
    { label: "步数", value: day.steps === null ? null : day.steps.toLocaleString("zh-CN"), unit: "", prefill: "步数 " },
    { label: "蛋白质", value: day.hasProtein ? `${Math.round(day.protein)}${day.partialProtein ? "+" : ""}` : null, unit: "g", prefill: "午餐：" },
  ];
  return <div className="stats">{cells.map(c => <button key={c.label} className={`stat${c.value === null ? " empty" : ""}`} onClick={() => actions.compose(c.prefill)}>
    <div className="stat-label">{c.label}</div>
    <div className="stat-value">{c.value ?? "—"}{c.value !== null && c.unit && <span className="stat-unit">{c.unit}</span>}</div>
  </button>)}</div>;
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
  const { data, actions } = useApp();
  const due = planCheckIns(data);
  const lastPhoto = data.items.filter(i => i.kind === "photo").map(i => i.date).sort().at(-1);
  if (!lastPhoto || lastPhoto < addDays(data.today, -27)) due.push({ key: "photo", label: lastPhoto ? "4 周没拍对比照" : "拍第一组对比照" });
  if (!due.length) return null;
  const open = (key: string) => key === "photo" ? actions.openTab("body", { screen: "photos" }) : key === "sync" ? void (window.location.href = `shortcuts://run-shortcut?name=${encodeURIComponent("同步健康")}`) : actions.compose(key === "weight" ? "体重 " : "腰围 ");
  return <div className="chips checkins">{due.map(d => <button key={d.key} className="chip" onClick={() => open(d.key)}><span className="dot" />{d.label}</button>)}</div>;
}

function DayLog() {
  const { data, date, actions } = useApp();
  const items = data.items.filter(i => i.date === date);
  const exercises = dayExercises(data.items, date).filter(e => e.rows.length > 0);
  const cardio = items.filter((i): i is Workout => i.kind === "workout" && i.sets.length === 0);
  const body = items.filter(i => i.kind === "metric");
  const recovery = items.filter(i => i.kind === "health");
  const notes = items.filter(i => i.kind === "note");
  const photos = items.filter(i => i.kind === "photo");
  const workingSets = exercises.reduce((n, e) => n + e.rows.filter(r => !r.set.isWarmup).length, 0);
  const real = items.filter(i => !isPlanned(i));
  if (!real.length && !items.length) return data.items.some(i => !isPlanned(i)) ? <Empty title={date === data.today ? "今天还没有记录" : "这一天没有记录"}>在下方输入，例如 <code>卧推 60kg 3x8</code></Empty> : <FirstRun />;
  const entry = (item: LogItem, value?: string, sub?: string) => <button key={item.id} className="entry" onClick={() => actions.edit(item)}>
    <span className="entry-main">{value ? (item.kind === "food" ? item.description : kindLabels[item.kind]) : itemSummary(item)}{sub && <span className="entry-sub">{sub}</span>}</span>
    {value && <span className="entry-value">{value}</span>}
  </button>;
  return <>
    {exercises.length > 0 && <Section title="训练" meta={`${exercises.length} 个动作 · ${workingSets} 组`}>{exercises.map(e => <ExerciseBlock key={e.key} exercise={e} />)}</Section>}
    {cardio.length > 0 && <Section title="运动">{cardio.map(w => entry(w, undefined, w.id.startsWith("health-") ? "来自 Apple 健康" : w.session === "Apple Watch" ? "来自截图" : undefined))}</Section>}
    <MealsSection date={date} />
    {body.length > 0 && <Section title="身体">{body.map(m => entry(m, undefined, m.id.startsWith("health-") ? "来自健康" : undefined))}</Section>}
    {recovery.length > 0 && <Section title="恢复">{recovery.map(h => entry(h, undefined, h.id.startsWith("health-") ? "来自健康" : undefined))}</Section>}
    {notes.length > 0 && <Section title="备注">{notes.map(n => entry(n, undefined, n.kind === "note" && n.category === "pain" ? "疼痛" : undefined))}</Section>}
    {photos.length > 0 && <Section title="照片"><button className="entry" onClick={() => actions.openTab("body", { screen: "photos" })}><span className="entry-main">这天拍了 {photos.length} 张</span><span className="entry-value"><ChevronRight size={16} /></span></button></Section>}
  </>;
}

function ExerciseBlock({ exercise }: { exercise: DayExercise }) {
  const { data, date, actions } = useApp();
  const target = exerciseTarget(data.items, exercise.id, date, exercise.unit, data.settings, data.today);
  const { name, unit, rows, previous } = exercise;
  const previousSets = previous ? previous.sets.filter(s => !s.isWarmup) : [];
  const pain = exercise.records.some(r => r.pain);
  const measure = primaryMeasure(unit);
  const merged: Workout = { ...exercise.records[0], sets: rows.map(r => r.set) };
  const value = sessionValue(merged, measure), before = previous ? sessionValue(previous, measure) : null;
  const lastLoaded = [...rows].reverse().find(r => !r.set.isWarmup && r.set.weightKg !== null)?.set.weightKg;
  const loadPrefix = lastLoaded == null ? "" : unit === "kg/side" ? `每边${lastLoaded}kg ` : unit === "kg/hand" ? `单手${lastLoaded}kg ` : unit === "added kg" ? `加重${lastLoaded}kg ` : unit === "assisted kg" ? `辅助${lastLoaded}kg ` : unit === "kg" ? `${lastLoaded}kg ` : "";
  let n = 0;
  return <div className="exercise">
    <button className="exercise-head" onClick={() => exercise.id && actions.openTab("strength", { screen: "exercise", params: { id: exercise.id } })}>
      <span className="exercise-name">{name}</span>
      {unitTags[unit] && <span className="tag">{unitTags[unit]}</span>}
      {pain && <span className="tag hot">疼痛</span>}
      {exercise.id && <ChevronRight className="row-chev" />}
    </button>
    {target && <div className={`target ${target.tone}`}><span className="faint">{target.last}</span><span>{target.text}</span></div>}
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
      <span>{value !== null ? `${measure === "reps" ? "总次数" : "估算 1RM"} ${fmt(value, measure === "reps" ? 0 : 1)}${before !== null ? ` · 比上次 ${signed(value - before, measure === "reps" ? 0 : 1)}` : ""}` : ""}</span>
      <button className="add-set" onClick={() => actions.compose(`${name} ${loadPrefix}`)}><Plus />一组</button>
    </div>
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

/** Created once in the shell so a pending reply or outbox survives switching tabs. */
export function useComposer(data: AppData, date: string, actions: Pick<Actions, "undo" | "reload">) {
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);
  const [outbox, setOutbox] = useState<Queued[]>(readOutbox);
  const identity = useRef<{ text: string; id: string } | null>(null);
  const flushing = useRef(false);

  const handle = useCallback((assistant: ChatMessage | undefined) => {
    if (!assistant) return;
    const extra = assistant.text.split("\n").filter(line => line && line !== "已记录：" && !line.startsWith("•")).join("\n");
    if (assistant.itemIds?.length) {
      const ids = assistant.itemIds;
      toast(`已记录 ${ids.length} 条`, { label: "撤销", run: () => void actions.undo(ids) });
      setReply(extra ? { kind: "info", text: extra } : null);
    } else if (assistant.clarification) setReply({ kind: "ask", text: assistant.text, pendingId: assistant.id });
    else setReply({ kind: "answer", text: assistant.text });
  }, [actions, toast]);

  const flush = useCallback(async () => {
    if (flushing.current || !navigator.onLine) return;
    const queued = readOutbox();
    if (!queued.length) return;
    flushing.current = true;
    try {
      for (const item of queued) {
        // A message written yesterday but sent today must still land on yesterday.
        const text = item.composeDate !== todayNZ() && !DATED.test(item.text) && !FINISH.test(item.text) ? `${item.composeDate} ${item.text}` : item.text;
        try {
          const result = await postJson<{ messages: ChatMessage[] }>("/api/chat", { id: item.id, text, pendingMessageId: null });
          handle(result.messages[1]);
        } catch (cause) {
          if (cause instanceof TypeError) break;
          setReply({ kind: "error", text: `一条离线记录没能保存：${cause instanceof Error ? cause.message : "未知错误"}\n原文：${item.text}` });
        }
        const rest = readOutbox().filter(q => q.id !== item.id); writeOutbox(rest); setOutbox(rest);
      }
      await actions.reload().catch(() => {});
    } finally { flushing.current = false; }
  }, [actions, handle]);

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
      handle(result.messages[1]);
      await actions.reload().catch(() => toast("已保存，但刷新失败，稍后会自动更新"));
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
  }, [actions, data.today, date, handle, reply, sending, toast]);

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
