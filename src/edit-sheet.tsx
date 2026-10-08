import { useState } from "react";
import { Plus, X } from "lucide-react";
import { baseSet, logItemSchema, metricLabels, type LogItem, type WorkingSet } from "@/lib/domain";
import { kindLabels, unitLabel } from "./labels";
import { Sheet } from "./ui";

const num = (value: string) => value === "" ? null : Number(value);
const feelOptions = [["", "感觉"], ["Easy", "轻松"], ["OK", "适中"], ["Hard", "吃力"]] as const;

export function EditSheet({ item, onClose, onSave, onUndo }: { item: LogItem; onClose: () => void; onSave: (item: LogItem) => Promise<void>; onUndo: () => void }) {
  const [draft, setDraft] = useState<LogItem>(structuredClone(item));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (key: string, value: unknown) => setDraft(previous => ({ ...previous, [key]: value } as LogItem));
  const updateSet = (index: number, key: keyof WorkingSet, value: unknown) => { if (draft.kind === "workout") update("sets", draft.sets.map((s, i) => i === index ? { ...s, [key]: value } : s)); };
  async function save() {
    const parsed = logItemSchema.safeParse(draft);
    if (!parsed.success) { setError(`请检查：${parsed.error.issues[0]?.message ?? "数值"}`); return; }
    setBusy(true); setError("");
    try { await onSave(parsed.data); onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败，修改仍保留。"); } finally { setBusy(false); }
  }
  const title = item.kind === "metric" ? metricLabels[item.metric] : item.kind === "workout" ? item.exerciseName ?? item.session : kindLabels[item.kind];
  const repsKey: keyof WorkingSet = draft.kind === "workout" && draft.unit === "seconds" ? "durationSec" : draft.kind === "workout" && draft.unit === "metres" ? "distanceM" : "reps";
  const hasLoad = draft.kind === "workout" && !["seconds", "metres", "bodyweight"].includes(draft.unit);
  return <Sheet open onClose={() => !busy && onClose()} title={title} right={<button className="text-btn strong" disabled={busy} onClick={() => void save()}>{busy ? "保存中" : "保存"}</button>}>
    <div className="form">
      <label className="field"><span className="field-label">日期</span><input className="input" type="date" value={draft.date} onChange={e => update("date", e.target.value)} /></label>
      {draft.kind === "metric" && <label className="field"><span className="field-label">{metricLabels[draft.metric]}（{draft.unit}）</span><input className="input num" type="number" inputMode="decimal" step="any" value={draft.value} onChange={e => update("value", Number(e.target.value))} /></label>}
      {draft.kind === "food" && <>
        <label className="field"><span className="field-label">吃了什么</span><textarea className="input" value={draft.description} onChange={e => update("description", e.target.value)} /></label>
        <div className="grid-2">
          <label className="field"><span className="field-label">热量 kcal</span><input className="input num" type="number" inputMode="numeric" value={draft.calories ?? ""} onChange={e => update("calories", num(e.target.value))} /></label>
          <label className="field"><span className="field-label">蛋白质 g</span><input className="input num" type="number" inputMode="decimal" value={draft.protein ?? ""} onChange={e => update("protein", num(e.target.value))} /></label>
          <label className="field"><span className="field-label">脂肪 g</span><input className="input num" type="number" inputMode="decimal" value={draft.fat ?? ""} onChange={e => update("fat", num(e.target.value))} /></label>
          <label className="field"><span className="field-label">碳水 g</span><input className="input num" type="number" inputMode="decimal" value={draft.carbs ?? ""} onChange={e => update("carbs", num(e.target.value))} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={draft.isEstimate} onChange={e => update("isEstimate", e.target.checked)} />营养数值是估算的</label>
      </>}
      {draft.kind === "health" && <div className="grid-2">
        <label className="field"><span className="field-label">睡眠 小时</span><input className="input num" type="number" inputMode="decimal" step="any" value={draft.sleepH ?? ""} onChange={e => update("sleepH", num(e.target.value))} /></label>
        <label className="field"><span className="field-label">步数</span><input className="input num" type="number" inputMode="numeric" value={draft.steps ?? ""} onChange={e => update("steps", num(e.target.value))} /></label>
      </div>}
      {draft.kind === "workout" && <>
        {draft.sets.length > 0 && <div>
          <div className="set-edit" style={{ borderTop: 0, fontSize: 11, color: "var(--ink-3)", paddingBottom: 0 }}><span /><span>{hasLoad ? `重量（${unitLabel(draft.unit)}）` : ""}</span><span>{repsKey === "reps" ? "次数" : repsKey === "durationSec" ? "秒" : "米"}</span><span /><span /></div>
          {draft.sets.map((set, i) => <div key={i}>
            <div className="set-edit">
              <span className="set-idx">{set.isWarmup ? "热" : i + 1}</span>
              {hasLoad ? <input className="input" type="number" inputMode="decimal" step="any" aria-label={`第 ${i + 1} 组重量`} value={set.weightKg ?? ""} onChange={e => updateSet(i, "weightKg", num(e.target.value))} /> : <span className="faint" style={{ fontSize: 14, textAlign: "center" }}>自重</span>}
              <input className="input" type="number" inputMode="numeric" aria-label={`第 ${i + 1} 组次数`} value={set[repsKey] as number | null ?? ""} onChange={e => updateSet(i, repsKey, num(e.target.value))} />
              <select className="input" aria-label={`第 ${i + 1} 组感觉`} value={set.feel ?? ""} onChange={e => updateSet(i, "feel", e.target.value || null)}>{feelOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <button className="icon-btn" aria-label={`删除第 ${i + 1} 组`} onClick={() => update("sets", draft.sets.filter((_, j) => j !== i))}><X /></button>
            </div>
          </div>)}
          <div className="btn-row" style={{ marginTop: 8, justifyContent: "space-between" }}>
            <button className="btn ghost" onClick={() => { const last = draft.sets.at(-1); const next = Math.max(0, ...draft.sets.map(s => s.ordinal ?? 0)) + 1; update("sets", [...draft.sets, { ...(last ?? baseSet), isWarmup: false, ...(last?.ordinal !== undefined ? { ordinal: next } : {}) }]); }}><Plus />加一组</button>
            <label className="check" style={{ fontSize: 14 }}><input type="checkbox" checked={draft.sets.some(s => s.isWarmup)} onChange={e => update("sets", draft.sets.map((s, i) => i === 0 ? { ...s, isWarmup: e.target.checked, ...(e.target.checked ? { ordinal: undefined } : {}) } : s))} />第一组是热身</label>
          </div>
        </div>}
        {draft.exerciseId === null && <div className="field"><span className="field-label">运动类型</span>
          <input className="input" value={draft.exerciseName ?? ""} maxLength={80} onChange={e => update("exerciseName", e.target.value)} />
          <div className="chips" style={{ marginTop: 8 }}>{["力量训练", "步行", "跑步", "骑车", "游泳", "高强度间歇"].map(name => <button key={name} type="button" className={`chip${draft.exerciseName === name ? " hot" : ""}`} onClick={() => update("exerciseName", name)}>{name}</button>)}</div>
        </div>}
        {draft.sets.length === 0 && <label className="field"><span className="field-label">时长 分钟</span><input className="input num" type="number" inputMode="numeric" value={draft.durationMin ?? ""} onChange={e => update("durationMin", num(e.target.value))} /></label>}
        <label className="check"><input type="checkbox" checked={draft.pain} onChange={e => { update("pain", e.target.checked); if (e.target.checked) update("painResolved", false); }} />这个动作有疼痛</label>
        {draft.pain && <label className="field"><span className="field-label">疼痛程度 0–10</span><input className="input num" type="number" inputMode="decimal" min={0} max={10} value={draft.painScore ?? ""} onChange={e => update("painScore", num(e.target.value))} /></label>}
        <label className="check"><input type="checkbox" checked={draft.painResolved} onChange={e => { update("painResolved", e.target.checked); if (e.target.checked) update("pain", false); }} />之前的疼痛已经恢复</label>
      </>}
      {draft.kind === "note" && <label className="field"><span className="field-label">备注</span><textarea className="input" value={draft.text} onChange={e => update("text", e.target.value)} /></label>}
      <label className="field"><span className="field-label">附注</span><textarea className="input" value={draft.notes} placeholder="可选" onChange={e => update("notes", e.target.value)} /></label>
      {item.source && item.source !== "私人照片上传" && <p className="footnote flush">原话：{item.source}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn block" style={{ color: "var(--down)" }} disabled={busy} onClick={() => { onUndo(); onClose(); }}>撤销这条记录</button>
    </div>
  </Sheet>;
}
