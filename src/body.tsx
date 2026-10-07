import { useEffect, useMemo, useRef, useState } from "react";
import { planStart } from "@/lib/diet";
import { DietReviewCard, PhaseVerdict } from "./insights-ui";
import { Camera, Download, ImagePlus, Plus } from "lucide-react";
import { addDays, metricLabels, type Metric, type Photo } from "@/lib/domain";
import { api } from "./api";
import { LineChart, Sparkline } from "./charts";
import { useApp } from "./context";
import { bodyPhotoKinds, phaseLabels, photoLabels } from "./labels";
import { dayLabel, fmt, measurementSummary, signed, weightTrend } from "./metrics";
import { Empty, Note, Screen, Section, Segmented, Sheet, useNav, useToast } from "./ui";

type Range = "4w" | "3m" | "all";
const ranges = [{ value: "4w" as const, label: "4 周" }, { value: "3m" as const, label: "3 个月" }, { value: "all" as const, label: "全部" }];
const since = (today: string, range: Range) => range === "4w" ? addDays(today, -27) : range === "3m" ? addDays(today, -91) : "0000";
type Girth = Exclude<Metric["metric"], "weight">;
// Only the girths that are actually measured; old hips/thigh rows stay in the data but are not shown.
const girths: Girth[] = ["waist", "arm"];

export function BodyScreen() {
  const { data, actions } = useApp();
  const nav = useNav();
  const [range, setRange] = useState<Range>("3m");
  const trend = weightTrend(data.items, data.today);
  const from = since(data.today, range);
  const series = trend.series.filter(p => p.date >= from);
  const phases = (data.settings.phaseHistory ?? []).map(p => ({ date: p.startDate, label: phaseLabels[p.phase] }));
  const phaseStartWeight = data.settings.phaseStart ? trend.series.filter(p => p.date <= data.settings.phaseStart!).at(-1) ?? trend.series.find(p => p.date >= data.settings.phaseStart!) : undefined;
  const sincePhase = trend.avg !== null && phaseStartWeight && phaseStartWeight.date !== trend.latest?.date ? trend.avg - phaseStartWeight.average : null;
  const rateNote = rateAdvice(data.settings.phase, trend.pct);
  const photos = data.items.filter((i): i is Photo => i.kind === "photo").sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  return <Screen root title="身体" kicker={<><span className={`phase-dot ${data.settings.phase}`} />体重、围度和照片都是线索，不等于肌肉量</>}>
    <div className="hero">
      <div className="hero-label">体重 · 7 天均值</div>
      <div className="hero-value">{fmt(trend.avg, 1)}<span className="hero-unit">kg</span></div>
      <div className="chips">
        {trend.perWeek !== null && <span className="chip">每周 {signed(trend.perWeek, 2)} kg（{signed(trend.pct!, 1)}%）</span>}
        {sincePhase !== null && <span className="chip">{phaseLabels[data.settings.phase]}以来 {signed(sincePhase, 1)} kg</span>}
        {data.settings.weightGoal !== null && trend.avg !== null && <span className="chip">距目标 {signed(trend.avg - data.settings.weightGoal, 1)} kg</span>}
      </div>
    </div>
    <LineChart points={series.map(p => ({ date: p.date, value: p.value }))} average={series.map(p => ({ date: p.date, value: p.average }))} unit="kg" goal={data.settings.weightGoal} phases={phases} emptyText="记几天体重后这里会出现趋势" />
    {series.length > 0 && <div className="legend"><span><i />每天</span><span><i className="avg" />7 天均值</span></div>}
    <div style={{ marginTop: 12 }}><Segmented label="时间范围" value={range} onChange={setRange} options={ranges} /></div>
    {planStart(data.settings) ? <DietReviewCard /> : rateNote && <Note tone={rateNote.tone}>{rateNote.text}</Note>}
    <PhaseVerdict />
    <div className="btn-row" style={{ marginTop: 16 }}><button className="btn" onClick={() => actions.compose("体重 ")}><Plus />记体重</button><button className="btn" onClick={() => actions.compose("腰围 ")}><Plus />记围度</button></div>

    <Section title="围度" meta={data.settings.phaseStart ? `与${phaseLabels[data.settings.phase]}开始对比` : undefined}>
      <div className="list">{girths.map(metric => {
        const m = measurementSummary(data.items, metric, data.settings);
        return <button key={metric} className="list-row" onClick={() => nav.push({ screen: "measure", params: { metric } })}>
          <div><div className="list-title">{metricLabels[metric]}</div><div className="list-sub">{m.latest ? `上次 ${dayLabel(m.latest.date)}` : "还没有记录"}</div></div>
          <Sparkline values={m.series.slice(-8).map(p => p.value)} />
          <div className="list-value"><strong>{m.latest ? fmt(m.latest.value, 1) : "—"}<small style={{ fontSize: 12, fontWeight: 500, color: "var(--ink-2)" }}>{m.latest ? " cm" : ""}</small></strong><small>{m.change !== null ? `${signed(m.change, 1)} cm` : " "}</small></div>
        </button>;
      })}</div>
      <p className="footnote flush">每 1–2 周在相同条件下量（早上、空腹、同一位置）。减脂期腰围下降、臂围和腿围稳定，同时力量保住，是比较理想的信号。</p>
    </Section>

    <Section title="照片" action={{ label: photos.length ? "全部" : "添加", onClick: () => nav.push({ screen: "photos" }) }}>
      <div className="photos">{bodyPhotoKinds.map(kind => {
        const latest = photos.find(p => p.photoKind === kind);
        return <button key={kind} className={`photo${latest ? "" : " empty-slot"}`} onClick={() => nav.push({ screen: "photos" })}>
          {latest ? <img src={`/api/photos/${latest.id}`} alt={`${photoLabels[kind]} ${latest.date}`} loading="lazy" /> : <Camera size={18} />}
          <span className="photo-label">{photoLabels[kind]}{latest ? ` · ${dayLabel(latest.date)}` : ""}</span>
        </button>;
      })}</div>
    </Section>
  </Screen>;
}

/** Commonly cited safe ranges; phrased as observations, never as a prescription. */
function rateAdvice(phase: string, pct: number | null) {
  if (pct === null) return null;
  if (phase === "fat_loss") {
    if (pct < -1) return { tone: "hold", text: "减重速度超过每周 1% 体重。速度太快时更难保住力量和肌肉，可以考虑稍微多吃一点。" };
    if (pct <= -0.25) return { tone: "good", text: "减重速度在每周 0.25–1% 之间，适合在保住力量的同时减脂。" };
    if (pct > 0.25) return { tone: "hold", text: "7 天均值在上升。单周波动常见（盐分、碳水、水分），连续两周上升再调整。" };
    return { tone: "", text: "体重基本持平。如果目标是减脂，再观察一周再决定是否调整。" };
  }
  if (phase === "lean_gain") {
    if (pct > 0.5) return { tone: "hold", text: "增重速度超过每周 0.5%，多出来的更可能是脂肪，可以稍微收一点。" };
    if (pct >= 0.1) return { tone: "good", text: "增重速度在每周 0.1–0.5% 之间，适合慢速增肌。" };
    return { tone: "", text: "体重还没有上升。增肌期通常需要略高于维持的热量。" };
  }
  return null;
}

export function MeasureDetail({ metric }: { metric: Girth }) {
  const { data, actions } = useApp();
  const [range, setRange] = useState<Range>("all");
  const m = measurementSummary(data.items, metric, data.settings);
  const goal = metric === "waist" ? data.settings.waistGoal : metric === "hips" ? data.settings.hipsGoal : null;
  const phases = (data.settings.phaseHistory ?? []).map(p => ({ date: p.startDate, label: phaseLabels[p.phase] }));
  const rows = data.items.filter(i => i.kind === "metric" && i.metric === metric).sort((a, b) => b.date.localeCompare(a.date));
  return <Screen title={metricLabels[metric]} back="身体">
    <div className="hero">
      <div className="hero-label">最近一次{m.latest ? ` · ${dayLabel(m.latest.date)}` : ""}</div>
      <div className="hero-value">{m.latest ? fmt(m.latest.value, 1) : "—"}<span className="hero-unit">cm</span></div>
      {m.change !== null && <div className="chips"><span className="chip">{phaseLabels[data.settings.phase]}以来 {signed(m.change, 1)} cm</span></div>}
    </div>
    <LineChart points={m.series.filter(p => p.date >= since(data.today, range))} unit="cm" goal={goal} phases={phases} emptyText="还没有这项记录" />
    <div style={{ marginTop: 12 }}><Segmented label="时间范围" value={range} onChange={setRange} options={ranges} /></div>
    <div className="btn-row" style={{ marginTop: 16 }}><button className="btn primary" onClick={() => actions.compose(`${metricLabels[metric]} `)}>记一次</button></div>
    {rows.length > 0 && <Section title="记录">{rows.map(r => <button key={r.id} className="entry" onClick={() => actions.edit(r)}><span className="entry-main">{dayLabel(r.date)}</span><span className="entry-value">{r.kind === "metric" ? `${r.value} cm` : ""}</span></button>)}</Section>}
  </Screen>;
}

export function PhotosScreen() {
  const { data, actions } = useApp();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<Photo["photoKind"]>("body_front");
  const photos = data.items.filter((i): i is Photo => i.kind === "photo").sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const matching = photos.filter(p => p.photoKind === kind);
  const dates = [...new Set(matching.map(p => p.date))];
  const [left, setLeft] = useState(""), [right, setRight] = useState("");
  const a = left && dates.includes(left) ? left : dates.at(-1) ?? "", b = right && dates.includes(right) ? right : dates[0] ?? "";
  const pa = matching.find(p => p.date === a), pb = matching.find(p => p.date === b);
  return <Screen title="照片" back="身体" right={<button className="text-btn strong" onClick={() => setAdding(true)}>添加</button>}>
    <p className="subtitle muted" style={{ fontSize: 14, marginTop: 4 }}>只存在你的账户里，登录后才能看，不会发给 AI。</p>
    <div style={{ marginTop: 18 }}><Segmented label="角度" value={kind} onChange={v => { setKind(v); setLeft(""); setRight(""); }} options={bodyPhotoKinds.map(k => ({ value: k, label: photoLabels[k] }))} /></div>
    {dates.length >= 2 ? <div className="compare-photos">{[{ value: a, set: setLeft, photo: pa }, { value: b, set: setRight, photo: pb }].map((side, i) => <div key={i}>
      <select className="input" aria-label={i ? "较近日期" : "较早日期"} value={side.value} onChange={e => side.set(e.target.value)}>{dates.map(d => <option key={d} value={d}>{d}</option>)}</select>
      {side.photo && <img src={`/api/photos/${side.photo.id}`} alt={`${photoLabels[kind]} ${side.value}`} />}
    </div>)}</div> : <div className="chart-empty" style={{ height: 120 }}>{dates.length ? "同一角度再拍一次，就能前后对比" : `还没有${photoLabels[kind]}照片`}</div>}
    <Section title="全部" meta={`${photos.length} 张`}>
      {photos.length ? <div className="gallery">{photos.map(p => <PhotoTile key={p.id} photo={p} onUndo={() => void actions.undo([p.id])} />)}</div>
        : <Empty title="还没有照片"><button className="btn" style={{ marginTop: 16 }} onClick={() => setAdding(true)}><ImagePlus />添加第一张</button></Empty>}
    </Section>
    <UploadSheet open={adding} onClose={() => setAdding(false)} initialKind={kind} />
  </Screen>;
}

function PhotoTile({ photo, onUndo }: { photo: Photo; onUndo: () => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="photo" onClick={() => setOpen(true)}><img src={`/api/photos/${photo.id}`} alt={`${photoLabels[photo.photoKind]} ${photo.date}`} loading="lazy" /><span className="photo-label">{photoLabels[photo.photoKind]} · {dayLabel(photo.date)}</span></button>
    <Sheet open={open} onClose={() => setOpen(false)} title={`${photoLabels[photo.photoKind]} · ${photo.date}`} tall left={<button className="text-btn" style={{ color: "var(--down)" }} onClick={() => { setOpen(false); onUndo(); }}>撤销</button>} right={<button className="text-btn strong" onClick={() => setOpen(false)}>完成</button>}>
      <img src={`/api/photos/${photo.id}`} alt="" style={{ width: "100%", borderRadius: 12 }} />
      <div className="btn-row" style={{ marginTop: 16 }}><a className="btn" href={`/api/photos/${photo.id}?download=1`}><Download />下载原图</a></div>
    </Sheet>
  </>;
}

function UploadSheet({ open, onClose, initialKind }: { open: boolean; onClose: () => void; initialKind: Photo["photoKind"] }) {
  const { data, actions } = useApp();
  const toast = useToast();
  const [kind, setKind] = useState(initialKind);
  const [date, setDate] = useState(data.today);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One ID per chosen file/date/angle: a retry after a lost response stores the photo once.
  const operation = useRef(crypto.randomUUID());
  const renew = () => { operation.current = crypto.randomUUID(); };
  const preview = useMemo(() => file ? URL.createObjectURL(file) : null, [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  async function upload() {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const body = new FormData();
      body.set("operationId", operation.current); body.set("file", file); body.set("date", date); body.set("kind", kind);
      await api("/api/photos", { method: "POST", body });
      renew(); setFile(null); await actions.reload(); toast("照片已保存"); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "上传失败，可以重试。"); }
    finally { setBusy(false); }
  }
  return <Sheet open={open} onClose={onClose} title="添加照片" right={<button className="text-btn strong" disabled={!file || busy} onClick={() => void upload()}>{busy ? "上传中…" : "保存"}</button>}>
    <div className="form">
      <label className="upload">
        {preview ? <img src={preview} alt="" style={{ maxHeight: 240, borderRadius: 10 }} /> : <ImagePlus size={26} />}
        <strong>{file ? file.name : "选择照片"}</strong><span>JPG、PNG、WebP · 12 MB 以内 · 保存原图</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { setFile(e.target.files?.[0] ?? null); setError(""); renew(); }} />
      </label>
      <div className="field"><span className="field-label">角度</span><Segmented label="角度" value={kind} onChange={v => { setKind(v); renew(); }} options={bodyPhotoKinds.map(k => ({ value: k, label: photoLabels[k] }))} /></div>
      <label className="field"><span className="field-label">拍摄日期</span><input className="input" type="date" value={date} max={data.today} onChange={e => { setDate(e.target.value); renew(); }} /></label>
      <p className="footnote flush">同样的光线、距离和姿势，早上空腹拍，对比才有意义。iPhone 的 HEIC 照片请在“设置 › 相机 › 格式”选“兼容性最佳”。</p>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  </Sheet>;
}
