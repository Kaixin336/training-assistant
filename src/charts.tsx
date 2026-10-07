import { useLayoutEffect, useRef, useState } from "react";

export type Point = { date: string; value: number };
const time = (date: string) => Date.parse(`${date}T12:00:00Z`);
const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const longDate = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;

function niceTicks(min: number, max: number, count = 4) {
  if (min === max) { const pad = Math.max(1, Math.abs(min) * .02); min -= pad; max += pad; }
  const raw = (max - min) / count, power = 10 ** Math.floor(Math.log10(raw)), n = raw / power;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * power;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(6)));
  return { lo, hi, ticks, step };
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useLayoutEffect(() => {
    const element = ref.current; if (!element) return;
    setWidth(element.clientWidth || 320);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width) || 320));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Line chart drawn directly in SVG. Tap or drag to read a value; vertical markers show
 * where a training phase began, so a cut and a build are never read as one trend.
 */
export function LineChart({ points, average, unit, goal, phases = [], digits = 1, height = 188, emptyText = "还没有数据" }: {
  points: Point[]; average?: Point[]; unit: string; goal?: number | null; phases?: { date: string; label: string }[]; digits?: number; height?: number; emptyText?: string;
}) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  if (!points.length) return <div className="chart-empty">{emptyText}</div>;
  const pad = { top: 16, right: 40, bottom: 24, left: 2 };
  const innerW = Math.max(40, width - pad.left - pad.right), innerH = height - pad.top - pad.bottom;
  let t0 = time(points[0].date), t1 = time(points.at(-1)!.date);
  if (t0 === t1) { t0 -= 3 * 86400000; t1 += 3 * 86400000; }
  const values = [...points.map(p => p.value), ...(average ?? []).map(p => p.value), ...(goal != null ? [goal] : [])];
  const { lo, hi, ticks } = niceTicks(Math.min(...values), Math.max(...values));
  const x = (date: string) => pad.left + (time(date) - t0) / (t1 - t0) * innerW;
  const y = (value: number) => pad.top + (1 - (value - lo) / (hi - lo || 1)) * innerH;
  const markers = phases.filter((p, i) => (i === 0 || phases[i - 1].label !== p.label) && x(p.date) > pad.left + 24 && x(p.date) < pad.left + innerW - 44);
  const path = (series: Point[]) => series.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const focus = active === null ? null : points[active];
  const focusAverage = focus && average?.find(p => p.date === focus.date);
  const pick = (clientX: number, target: SVGSVGElement) => {
    const left = target.getBoundingClientRect().left, px = clientX - left;
    let best = 0, distance = Infinity;
    points.forEach((p, i) => { const d = Math.abs(x(p.date) - px); if (d < distance) { distance = d; best = i; } });
    setActive(best);
  };
  return <div className="chart" ref={ref}>
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`趋势图，共 ${points.length} 个数据点，最新 ${points.at(-1)!.value.toFixed(digits)} ${unit}`}
      onPointerDown={e => pick(e.clientX, e.currentTarget)} onPointerMove={e => { if (e.buttons || e.pointerType === "mouse") pick(e.clientX, e.currentTarget); }} onPointerLeave={() => setActive(null)} onPointerCancel={() => setActive(null)}>
      {ticks.map(t => <g key={t}><line className="grid" x1={pad.left} x2={pad.left + innerW} y1={y(t)} y2={y(t)} /><text className="axis" x={width - 2} y={y(t) + 4} textAnchor="end">{Number(t.toFixed(2))}</text></g>)}
      {markers.map(m => <g key={m.date}><line className="grid" x1={x(m.date)} x2={x(m.date)} y1={pad.top - 6} y2={pad.top + innerH} strokeDasharray="3 3" style={{ stroke: "var(--ink-3)" }} /><text className="band-label" x={x(m.date) + 4} y={pad.top - 2}>{m.label}</text></g>)}
      {goal != null && goal >= lo && goal <= hi && <g><line className="goal" x1={pad.left} x2={pad.left + innerW} y1={y(goal)} y2={y(goal)} /><text className="goal-label" x={pad.left + 2} y={y(goal) - 4}>目标 {goal}</text></g>}
      {points.length > 1 && <path className={`series${average ? "" : " main"}`} d={path(points)} />}
      {average && average.length > 1 && <path className="avg" d={path(average)} />}
      {points.length <= 60 && points.map(p => <circle key={p.date} className={`dot${average ? " soft" : ""}`} cx={x(p.date)} cy={y(p.value)} r={average ? 2.2 : 2.8} />)}
      <text className="axis" x={pad.left} y={height - 4}>{shortDate(points[0].date)}</text>
      {points.length > 1 && <text className="axis" x={pad.left + innerW} y={height - 4} textAnchor="end">{shortDate(points.at(-1)!.date)}</text>}
      {focus && <g><line className="cursor" x1={x(focus.date)} x2={x(focus.date)} y1={pad.top} y2={pad.top + innerH} /><circle className="focus" cx={x(focus.date)} cy={y(focus.value)} r={5} /></g>}
    </svg>
    {focus && <div className="chart-tip" style={{ left: Math.min(Math.max(x(focus.date), 70), width - 70), top: 6 }}>
      {focus.value.toFixed(digits)} {unit}{focusAverage ? ` · 均值 ${focusAverage.value.toFixed(digits)}` : ""}<span>{longDate(focus.date)}</span>
    </div>}
  </div>;
}

export function Sparkline({ values, width = 56, height = 22 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <svg className="spark" width={width} height={height} aria-hidden="true" />;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const xy = values.map((v, i) => [i / (values.length - 1) * (width - 4) + 2, height - 3 - (v - min) / span * (height - 6)] as const);
  return <svg className="spark" width={width} height={height} aria-hidden="true">
    <polyline points={xy.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" ")} />
    <circle cx={xy.at(-1)![0]} cy={xy.at(-1)![1]} r={2.5} />
  </svg>;
}
