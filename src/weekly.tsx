import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle, Sparkles } from "lucide-react";
import { addDays, weekStart } from "@/lib/domain";
import { buildWeeklySummary, type ExerciseComparison, type WeeklySummary } from "@/lib/weekly-summary";
import { api, postJson } from "./api";
import { useApp } from "./context";
import { unitTags } from "./labels";
import { dayLabel, fmt, setText, signed } from "./metrics";
import { Empty, Note, Screen, Section } from "./ui";
import { LoadAndCycle, MuscleVolume, TrainingCalendar } from "./insights-ui";

export function WeeklyScreen() {
  const { data, actions } = useApp();
  // 0 = this week so far (preview), 1 = last complete week (default), 2+ = older weeks.
  const [weeksBack, setWeeksBack] = useState(1);
  const end = weeksBack === 0 ? data.today : addDays(weekStart(data.today), -1 - 7 * (weeksBack - 1));
  const report = useMemo(() => buildWeeklySummary(data, end), [data, end]);
  const preview = report.comparisonMode === "same_elapsed_days";
  const thisWeek = weeksBack === 0;
  const { current, previous, changes } = report;
  const proteinPerKg = current.protein.value !== null && current.weight.value ? current.protein.value / current.weight.value : null;
  const cells: { label: string; value: string; unit?: string; delta: string }[] = [
    { label: "训练天数", value: fmt(current.training.days, 0), delta: changes.trainingDays === null ? "上周 —" : `上周 ${fmt(previous.training.days, 0)}` },
    { label: "工作组", value: fmt(current.training.workingSets, 0), delta: changes.workingSets === null ? "—" : `${signed(changes.workingSets, 0)} 组` },
    { label: "总次数", value: fmt(current.training.totalReps, 0), delta: changes.totalReps === null ? "—" : `${signed(changes.totalReps, 0)} 次` },
    { label: "体重均值", value: fmt(current.weight.value, 1), unit: "kg", delta: changes.weight === null ? `${current.weight.days} 天有记录` : `${signed(changes.weight, 2)} kg` },
    { label: "睡眠均值", value: fmt(current.health.sleepH.value, 1), unit: "h", delta: current.health.sleepH.value === null || previous.health.sleepH.value === null ? `${current.health.sleepH.days} 天有记录` : `${signed(current.health.sleepH.value - previous.health.sleepH.value, 1)} h` },
    { label: "蛋白质均值", value: fmt(current.protein.value, 0), unit: "g", delta: proteinPerKg !== null ? `${proteinPerKg.toFixed(1)} g/kg 体重` : `${current.protein.days} 天完整记录` },
  ];
  const exercises = report.exerciseComparisons.filter(e => e.current);
  const dropped = report.exerciseComparisons.filter(e => !e.current && e.previous);
  const notes = [...new Set([report.phase.message, ...report.phase.focus])].filter(Boolean);
  return <Screen root title="周报" kicker={<>{preview ? "本周至今" : "完整一周"} · {current.recordedDays}/{report.period.days} 天有记录</>}>
    <div className="week" style={{ gridTemplateColumns: "44px 1fr 44px" }}>
      <button className="week-nav" aria-label="上一周" onClick={() => setWeeksBack(weeksBack + 1)}><ChevronLeft /></button>
      <div style={{ textAlign: "center", fontSize: 15, fontWeight: 600 }} className="num">{dayLabel(report.period.start)} – {dayLabel(report.period.end)}{thisWeek && <span className="faint" style={{ fontWeight: 400 }}> · 至今</span>}</div>
      <button className="week-nav" aria-label={weeksBack === 1 ? "本周至今" : "下一周"} disabled={thisWeek} onClick={() => setWeeksBack(weeksBack - 1)}><ChevronRight /></button>
    </div>
    <div className="summary">{cells.map(c => <div key={c.label}><div className="summary-label">{c.label}</div><div className="summary-value">{c.value}{c.unit && c.value !== "—" && <small>{c.unit}</small>}</div><div className="summary-delta">{c.delta}</div></div>)}</div>
    <p className="footnote flush">{preview ? `与上周相同的 ${report.period.days} 天对比。` : "与前一个完整周对比。"}没记录的日子不算作 0。</p>
    <TrainingCalendar />
    <AiReview report={report} enabled={data.aiEnabled} onConnect={() => actions.openTab("me", { screen: "ai" })} />
    <MuscleVolume from={report.period.start} to={report.period.end} />
    {exercises.length > 0 ? <Section title="动作对比" meta={`${exercises.length} 个`}>{exercises.map(e => <ExerciseCompare key={e.key} item={e} />)}</Section>
      : <Empty title="这周没有力量记录">{preview ? "练完记下来，这里会和上周同一动作对比。" : "换一周看看。"}</Empty>}
    {dropped.length > 0 && <p className="footnote flush">上周做过、这周没做：{dropped.map(e => e.name).join("、")}</p>}
    {report.pain.records.length > 0 && <Section title="疼痛">
      {report.pain.records.map(p => <div key={p.id} className="entry"><span className="entry-main">{p.exerciseName ?? "未指明动作"}<span className="entry-sub">{dayLabel(p.date)}{p.score !== null ? ` · ${p.score}/10` : ""}{p.text ? ` · ${p.text}` : ""}</span></span></div>)}
      <Note tone="care">{report.pain.message}</Note>
    </Section>}
    {weeksBack <= 1 && <LoadAndCycle />}
    {notes.length > 0 && <Section title="阶段">{notes.map((n, i) => <p key={i} className="footnote flush">{n}</p>)}</Section>}
  </Screen>;
}

function ExerciseCompare({ item }: { item: ExerciseComparison }) {
  const latest = item.latest, prior = item.previousLatest;
  return <div className="exercise">
    <div className="exercise-head"><span className="exercise-name">{item.name}</span>{unitTags[item.unit] && <span className="tag">{unitTags[item.unit]}</span>}{item.current?.sessions.some(s => s.pain) && <span className="tag hot">疼痛</span>}</div>
    <div className="compare">
      <div><div className="compare-label">本周{latest ? ` · ${dayLabel(latest.date)}` : ""}</div><div className="compare-sets">{latest ? latest.sets.filter(s => !s.isWarmup).map(s => setText(s, item.unit)).join("  ") : "—"}</div></div>
      <div><div className="compare-label">上周{prior ? ` · ${dayLabel(prior.date)}` : ""}</div><div className="compare-sets">{prior ? prior.sets.filter(s => !s.isWarmup).map(s => setText(s, item.unit)).join("  ") : "—"}</div></div>
    </div>
    <div className="chips" style={{ marginTop: 8 }}>
      {item.delta.topWeight !== null && item.delta.topWeight !== 0 && <span className={`chip ${item.delta.topWeight > 0 ? "up" : "down"}`}>最重 {signed(item.delta.topWeight, 1)} kg</span>}
      {item.delta.totalReps !== null && item.delta.totalReps !== 0 && <span className={`chip ${item.delta.totalReps > 0 ? "up" : "down"}`}>次数 {signed(item.delta.totalReps, 0)}</span>}
      {item.delta.workingSets !== null && item.delta.workingSets !== 0 && <span className="chip">组数 {signed(item.delta.workingSets, 0)}</span>}
    </div>
    <p className="footnote flush">{item.observation}</p>
  </div>;
}

function AiReview({ report, enabled, onConnect }: { report: WeeklySummary; enabled: boolean; onConnect: () => void }) {
  const [saved, setSaved] = useState<{ id: string; text: string | null; stale: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const end = report.period.end;
  // Loading a saved review never calls the model; only the button below does.
  useEffect(() => {
    if (!enabled || !report.current.recordCount) return;
    let live = true;
    api<{ text: string | null; stale: boolean }>(`/api/weekly/ai?weekEnd=${end}`).then(r => { if (live) setSaved({ id: report.id, ...r }); }).catch(() => {});
    return () => { live = false; };
  }, [enabled, end, report.id, report.current.recordCount]);
  if (!report.current.recordCount) return null;
  const current = saved?.id === report.id ? saved : null;
  async function run() {
    setBusy(true); setError("");
    try { const result = await postJson<{ text: string }>("/api/weekly/ai", { weekEnd: end }); setSaved({ id: report.id, text: result.text, stale: false }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "生成失败"); }
    finally { setBusy(false); }
  }
  if (!enabled) return <button className="row" style={{ marginTop: 18, padding: "12px 0" }} onClick={onConnect}><span className="row-icon"><Sparkles /></span><span className="row-main"><span className="row-title" style={{ display: "block" }}>AI 点评</span><span className="row-sub" style={{ display: "block" }}>连接 DeepSeek 后，可以让它读这一周的统计给出建议</span></span><ChevronRight className="row-chev" /></button>;
  return <Section title="AI 点评" meta={current?.text ? "基于本页统计" : undefined}>
    {current?.text && <p className="prose" style={{ whiteSpace: "pre-wrap" }}>{current.text}</p>}
    {(!current?.text || current.stale) && <button className="btn block" style={{ marginTop: current?.text ? 12 : 0 }} disabled={busy} onClick={() => void run()}>{busy ? <LoaderCircle className="spin" /> : <Sparkles />}{busy ? "正在读这一周…" : current?.stale ? "记录有更新 · 重新点评" : "生成这周的点评"}</button>}
    {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
  </Section>;
}
