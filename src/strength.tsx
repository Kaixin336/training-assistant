import { useMemo, useState } from "react";
import { Ellipsis } from "lucide-react";
import { addDays } from "@/lib/domain";
import { LineChart, Sparkline } from "./charts";
import { useApp } from "./context";
import { phaseLabels, unitLabel, unitTags } from "./labels";
import { dayLabel, exerciseList, fmt, LOADED, measureLabels, nextStep, phaseComparison, sessionText, sessionValue, signed, type ExerciseInfo, type Measure } from "./metrics";
import { Empty, Note, Screen, Section, Segmented, Sheet, useNav, useToast } from "./ui";
import { useStrengthMarks } from "./insights-ui";

export function StrengthList() {
  const { data } = useApp();
  const nav = useNav();
  const exercises = useMemo(() => exerciseList(data.items), [data.items]);
  const comparisons = exercises.map(e => ({ e, c: phaseComparison(e.sessions, data.settings, e.measure) }));
  const counted = comparisons.filter(x => x.c);
  const kept = counted.filter(x => x.c!.tone === "good").length, held = counted.filter(x => x.c!.tone === "hold").length, care = counted.filter(x => x.c!.tone === "care").length;
  const { levels, stalls } = useStrengthMarks();
  return <Screen root title="力量" kicker={data.settings.phase !== "unspecified" ? <><span className={`phase-dot ${data.settings.phase}`} />{phaseLabels[data.settings.phase]}</> : undefined}>
    {counted.length > 0 && <div className="hero">
      <div className="hero-label">{phaseLabels[data.settings.phase]}以来 · {counted.length} 个动作</div>
      <div className="chips">
        <span className="chip up">{data.settings.phase === "lean_gain" ? "进步" : "保持"} {kept}</span>
        {held > 0 && <span className="chip">{data.settings.phase === "lean_gain" ? "持平" : "下降"} {held}</span>}
        {care > 0 && <span className="chip hot">疼痛 {care}</span>}
      </div>
    </div>}
    {exercises.length ? <Section title="动作" meta={`${exercises.length} 个`}>
      <div className="list">{comparisons.map(({ e, c }) => <button key={e.id} className="list-row" onClick={() => nav.push({ screen: "exercise", params: { id: e.id } })}>
        <div><div className="list-title">{e.name}{unitTags[e.unit] && <> <span className="tag">{unitTags[e.unit]}</span></>}{levels.get(e.id) && <> <span className="tag">{levels.get(e.id)!.level}</span></>}{stalls.get(e.id) && <> <span className={`tag ${stalls.get(e.id)!.tone === "care" ? "hot" : ""}`}>{stalls.get(e.id)!.tone === "care" ? "下降" : "停滞"}</span></>}</div><div className="list-sub">{e.sessions.length} 次 · 上次 {dayLabel(e.last)}</div></div>
        <Sparkline values={e.values.slice(-10)} />
        <div className="list-value"><strong>{fmt(e.values.at(-1) ?? null, e.measure === "reps" ? 0 : 1)}<span className="list-unit">{e.measure === "reps" ? "次" : "kg"}</span></strong><small className={c ? c.tone === "good" && Math.abs(c.ratio - 1) >= .01 ? "up" : c.tone === "care" ? "hot" : "" : ""}>{c ? Math.abs(c.ratio - 1) < .01 ? "持平" : c.short : e.measure === "reps" ? "总次数" : "估算 1RM"}</small></div>
      </button>)}</div>
    </Section> : <Empty title="还没有力量记录">在“今天”里记下第一组，比如 <code>深蹲 80kg 5x5</code>。每个动作都会有自己的曲线。</Empty>}
  </Screen>;
}

type Range = "3m" | "1y" | "all";
export function ExerciseDetail({ id }: { id: string }) {
  const { data, actions, setDate } = useApp();
  const nav = useNav();
  const exercise = useMemo(() => exerciseList(data.items).find(e => e.id === id), [data.items, id]);
  const [measureChoice, setMeasure] = useState<Measure>("e1rm");
  const [range, setRange] = useState<Range>("all");
  const [renaming, setRenaming] = useState(false);
  const marks = useStrengthMarks();
  if (!exercise) return <Screen title="动作" back="力量" large={false}><Empty title="这个动作没有记录了">可能已被合并或撤销。</Empty></Screen>;
  const loaded = LOADED.has(exercise.unit);
  const measure: Measure = loaded ? measureChoice : "reps";
  const digits = measure === "reps" ? 0 : 1, unit = measure === "reps" ? "次" : "kg";
  const from = range === "3m" ? addDays(data.today, -91) : range === "1y" ? addDays(data.today, -365) : "0000";
  const byDay = new Map<string, number>();
  for (const w of [...exercise.sessions].reverse()) { const v = sessionValue(w, measure); if (v !== null && w.date >= from) byDay.set(w.date, Math.max(byDay.get(w.date) ?? -Infinity, v)); }
  const points = [...byDay].map(([date, value]) => ({ date, value }));
  const latest = exercise.sessions[0], previous = exercise.sessions[1];
  const now = latest ? sessionValue(latest, measure) : null, before = previous ? sessionValue(previous, measure) : null;
  const comparison = phaseComparison(exercise.sessions, data.settings, measure);
  const advice = nextStep(exercise.sessions, data.settings, exercise.unit);
  const phases = (data.settings.phaseHistory ?? []).map(p => ({ date: p.startDate, label: phaseLabels[p.phase] }));
  const range_ = latest?.repMin != null && latest.repMax != null ? `目标 ${latest.repMin}–${latest.repMax} 次` : null;
  const lastLoad = latest?.sets.filter(s => !s.isWarmup && s.weightKg !== null).at(-1)?.weightKg;
  const prefix = lastLoad == null ? "" : exercise.unit === "kg/side" ? `每边${lastLoad}kg ` : exercise.unit === "kg/hand" ? `单手${lastLoad}kg ` : exercise.unit === "added kg" ? `加重${lastLoad}kg ` : exercise.unit === "assisted kg" ? `辅助${lastLoad}kg ` : exercise.unit === "kg" ? `${lastLoad}kg ` : "";
  return <Screen title={exercise.name} back="力量" right={<button className="icon-btn" aria-label="重命名或合并" onClick={() => setRenaming(true)}><Ellipsis /></button>}>
    <p className="subtitle muted" style={{ fontSize: 14, marginTop: 4 }}>{[unitLabel(exercise.unit), `${exercise.sessions.length} 次训练`, range_].filter(Boolean).join(" · ")}</p>
    {loaded && <div style={{ marginTop: 18 }}><Segmented label="指标" value={measure} onChange={setMeasure} options={(Object.keys(measureLabels) as Measure[]).map(m => ({ value: m, label: measureLabels[m] }))} /></div>}
    <div className="hero">
      <div className="hero-label">{measureLabels[measure]} · 最近一次</div>
      <div className="hero-value">{fmt(now, digits)}<span className="hero-unit">{unit}</span></div>
      <div className="chips">
        {now !== null && before !== null && <span className={`chip ${now > before ? "up" : now < before * .95 ? "down" : ""}`}>比上次 {signed(now - before, digits)}</span>}
        {comparison && <span className={`chip ${comparison.tone === "good" ? "up" : comparison.tone === "care" ? "hot" : ""}`}>{phaseLabels[data.settings.phase]} {comparison.short}</span>}
      </div>
    </div>
    <LineChart points={points} unit={unit} digits={digits} phases={phases} emptyText="这个范围内没有记录" />
    <div style={{ marginTop: 12 }}><Segmented label="时间范围" value={range} onChange={setRange} options={[{ value: "3m", label: "3 个月" }, { value: "1y", label: "1 年" }, { value: "all", label: "全部" }]} /></div>
    {advice && <Note tone={advice.tone}>{advice.text}</Note>}
    {marks.stalls.get(id) && <Note tone={marks.stalls.get(id)!.tone}>{marks.stalls.get(id)!.text}</Note>}
    {marks.levels.get(id) && <p className="verdict">力量水平：{marks.levels.get(id)!.level}（{marks.levels.get(id)!.ratio.toFixed(2)} 倍体重）{marks.levels.get(id)!.next ? `，估算 1RM 到 ${marks.levels.get(id)!.next!.kg} kg 是「${marks.levels.get(id)!.next!.level}」` : ""}。</p>}
    {comparison && <Note tone={comparison.tone}>{comparison.text}</Note>}
    <div className="btn-row" style={{ marginTop: 18 }}><button className="btn primary" onClick={() => actions.compose(`${exercise.name} ${prefix}`)}>记一组</button></div>
    <Section title="历史" meta={measure === "e1rm" ? "Epley 公式，仅 1–12 次的组" : undefined}>
      {exercise.sessions.map(w => <button key={`${w.trainingSessionId ?? w.date}-${w.id}`} className="history-row" onClick={() => { setDate(w.date); actions.openTab("today"); }}>
        <span className="history-date">{dayLabel(w.date)}</span>
        <span><span className="history-sets" style={{ display: "block" }}>{sessionText(w)}</span><span className="history-meta" style={{ display: "block" }}>{[sessionValue(w, measure) !== null ? `${measureLabels[measure]} ${fmt(sessionValue(w, measure), digits)}` : "", w.pain ? "有疼痛" : "", w.sets.some(s => s.feel === "Hard") ? "有吃力组" : ""].filter(Boolean).join(" · ")}</span></span>
      </button>)}
    </Section>
    <RenameSheet open={renaming} onClose={() => setRenaming(false)} exercise={exercise} onDone={merged => { setRenaming(false); if (merged) nav.pop(); }} />
  </Screen>;
}

function RenameSheet({ open, onClose, exercise, onDone }: { open: boolean; onClose: () => void; exercise: ExerciseInfo; onDone: (merged: boolean) => void }) {
  const { data, actions } = useApp();
  const toast = useToast();
  const [name, setName] = useState(exercise.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const others = exerciseList(data.items).filter(e => e.unit === exercise.unit && e.id !== exercise.id);
  const target = others.find(e => e.name.replace(/\s/g, "").toLowerCase() === name.replace(/\s/g, "").toLowerCase());
  async function save() {
    setBusy(true); setError("");
    try {
      const result = await actions.action("rename_exercise", { item: { exerciseId: exercise.id, unit: exercise.unit, name: name.trim() } });
      toast(result.message ?? "已保存");
      onDone(!!target);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败"); }
    finally { setBusy(false); }
  }
  return <Sheet open={open} onClose={onClose} title="重命名或合并" right={<button className="text-btn strong" disabled={busy || !name.trim() || name.trim() === exercise.name} onClick={() => void save()}>{target ? "合并" : "保存"}</button>}>
    <div className="form">
      <label className="field"><span className="field-label">动作名称</span><input className="input" value={name} onChange={e => setName(e.target.value)} maxLength={160} /></label>
      {target ? <Note tone="hot">将把这 {exercise.sessions.length} 次训练合并到“{target.name}”。以后再写“{exercise.name}”也会记到同一个动作里。</Note>
        : <p className="sheet-desc" style={{ margin: 0 }}>改名只影响显示，所有历史记录保持连续。同一个动作被记成了两个名字时，在下面选另一个名字即可合并。</p>}
      {others.length > 0 && <div>
        <div className="field-label" style={{ marginBottom: 6 }}>合并到同口径（{unitLabel(exercise.unit)}）的动作</div>
        <div className="chips">{others.map(o => <button key={o.id} className={`chip${target?.id === o.id ? " hot" : ""}`} onClick={() => setName(o.name)}>{o.name}</button>)}</div>
      </div>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  </Sheet>;
}
