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
import { dayBalance } from "@/lib/insights";

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
    { label: "训练", value: fmt(current.training.days, 0), unit: "天", delta: changes.trainingDays === null ? " " : `上周 ${fmt(previous.training.days, 0)}` },
    { label: "工作组", value: fmt(current.training.workingSets, 0), delta: changes.workingSets === null ? " " : `${signed(changes.workingSets, 0)}` },
    { label: "体重", value: fmt(current.weight.value, 1), unit: "kg", delta: changes.weight === null ? " " : `${signed(changes.weight, 2)}` },
  ];
  // Average daily energy balance over the week's complete days.
  const balances = Array.from({ length: report.period.days }, (_, i) => addDays(report.period.start, i)).filter(d => d < data.today).map(d => dayBalance(data.items, d, data.today)).filter((b): b is NonNullable<typeof b> => !!b);
  const avgDiff = balances.length ? Math.round(balances.reduce((n, b) => n + b.diff, 0) / balances.length / 10) * 10 : 0;
  const quiet = [
    current.health.sleepH.value !== null ? `睡眠 ${fmt(current.health.sleepH.value, 1)} h` : "",
    current.protein.value !== null ? `蛋白质 ${fmt(current.protein.value, 0)} g${proteinPerKg !== null ? `（${proteinPerKg.toFixed(1)} g/kg）` : ""}` : "",
    current.training.totalReps ? `${fmt(current.training.totalReps, 0)} 次` : "",
    balances.length >= 3 ? `日均${avgDiff <= 0 ? "缺口" : "盈余"} ${Math.abs(avgDiff).toLocaleString("zh-CN")} kcal` : "",
  ].filter(Boolean).join(" · ");
  const exercises = report.exerciseComparisons.filter(e => e.current);
  const dropped = report.exerciseComparisons.filter(e => !e.current && e.previous);
  return <Screen root title="周报" kicker={<>{preview ? "本周至今" : "完整一周"} · {current.recordedDays}/{report.period.days} 天有记录</>}>
    <div className="week" style={{ gridTemplateColumns: "44px 1fr 44px" }}>
      <button className="week-nav" aria-label="上一周" onClick={() => setWeeksBack(weeksBack + 1)}><ChevronLeft /></button>
      <div style={{ textAlign: "center", fontSize: 15, fontWeight: 600 }} className="num">{dayLabel(report.period.start)} – {dayLabel(report.period.end)}{thisWeek && <span className="faint" style={{ fontWeight: 400 }}> · 至今</span>}</div>
      <button className="week-nav" aria-label={weeksBack === 1 ? "本周至今" : "下一周"} disabled={thisWeek} onClick={() => setWeeksBack(weeksBack - 1)}><ChevronRight /></button>
    </div>
    <div className="summary">{cells.map(c => <div key={c.label}><div className="summary-label">{c.label}</div><div className="summary-value">{c.value}{c.unit && c.value !== "—" && <small>{c.unit}</small>}</div><div className="summary-delta">{c.delta}</div></div>)}</div>
    {quiet && <p className="quiet">{quiet}</p>}
    <TrainingCalendar week={report.period.start} />
    <AiReview report={report} enabled={data.aiEnabled} onConnect={() => actions.openTab("me", { screen: "ai" })} />
    <MuscleVolume from={report.period.start} to={report.period.end} />
    {exercises.length > 0 ? <Section title="动作" meta={preview ? "与上周同期" : "与上周"}>{exercises.map(e => <ExerciseCompare key={e.key} item={e} />)}</Section>
      : <Empty title="这周没有力量记录">{preview ? "练完记下来，这里会和上周同一动作对比。" : "换一周看看。"}</Empty>}
    {dropped.length > 0 && <p className="footnote flush">上周做过、这周没做：{dropped.map(e => e.name).join("、")}</p>}
    {report.pain.records.length > 0 && <Section title="疼痛">
      {report.pain.records.map(p => <div key={p.id} className="entry"><span className="entry-main">{p.exerciseName ?? "未指明动作"}<span className="entry-sub">{dayLabel(p.date)}{p.score !== null ? ` · ${p.score}/10` : ""}{p.text ? ` · ${p.text}` : ""}</span></span></div>)}
      <Note tone="care">{report.pain.message}</Note>
    </Section>}
    {weeksBack <= 1 && <LoadAndCycle />}

  </Screen>;
}

function ExerciseCompare({ item }: { item: ExerciseComparison }) {
  const { actions } = useApp();
  const latest = item.latest;
  const sets = latest ? latest.sets.filter(s => !s.isWarmup).map(s => setText(s, item.unit)) : [];
  const { topWeight, totalReps } = item.delta;
  const change = topWeight ? { text: `${signed(topWeight, 1)} kg`, tone: topWeight > 0 ? "up" : "down" }
    : totalReps ? { text: `${signed(totalReps, 0)} 次`, tone: totalReps > 0 ? "up" : "down" }
    : item.previousLatest ? { text: "持平", tone: "" } : { text: "新", tone: "" };
  return <button className="cmp" onClick={() => item.exerciseId && actions.openTab("strength", { screen: "exercise", params: { id: item.exerciseId } })}>
    <span className="cmp-name">{item.name}{unitTags[item.unit] && <span className="tag">{unitTags[item.unit]}</span>}{item.current?.sessions.some(s => s.pain) && <span className="tag hot">疼痛</span>}</span>
    <span className={`cmp-change ${change.tone}`}>{change.text}</span>
    <span className="cmp-sets">{sets.join("  ") || "—"}</span>
  </button>;
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
