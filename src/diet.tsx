import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, dailyHealthValue, dailyTotals, dayDiff, weekStart, type Food, type LogItem, type Settings } from "@/lib/domain";
import { isPlanned, planMeals, planOf, planStart, planTargets, SLOTS, slotOf } from "@/lib/diet";
import { dayBalance, nutritionTargets } from "@/lib/insights";
import { useApp } from "./context";
import { DietReviewCard } from "./insights-ui";
import { dayLabel, signed, weekday } from "./metrics";
import { DayTypeToggle } from "./plan-ui";
import { Empty, Note, Row, Screen, Section, useNav, useToast } from "./ui";

const kcal = (n: number) => Math.round(n).toLocaleString("zh-CN");

/**
 * 饮食: is the eating on track? The week as daily balance bars (also the day picker), the chosen day's
 * intake against its targets, the meal table, the plan's review, and the plan itself one tap away.
 * Recording still happens on 今天; the same chosen day is shared with that page.
 */
export function DietScreen() {
  const { data, date, setDate } = useApp();
  const isToday = date === data.today;
  const start = planStart(data.settings);
  const planDay = start && start <= date ? dayDiff(date, start) + 1 : null;
  return <Screen root title="饮食"
    kicker={<><DayTypeToggle date={date} />{isToday ? "今天" : dayLabel(date)} · {weekday(date)}{planDay ? ` · 计划第 ${planDay} 天` : ""}</>}
    right={!isToday ? <button className="text-btn strong" onClick={() => setDate(data.today)}>今天</button> : undefined}>
    <BalanceWeek />
    <DayIntake />
    <MealsTable />
    <DietReviewCard />
    <PlanLink />
  </Screen>;
}

/** Monday–Sunday: one bar per day for the energy balance, tap a day to show it below. */
function BalanceWeek() {
  const { data, date, setDate } = useApp();
  const cutting = data.settings.phase !== "lean_gain";
  const monday = weekStart(date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const balances = days.map(d => d <= data.today ? dayBalance(data.items, d, data.today) : null);
  const scale = Math.max(600, ...balances.map(b => b ? Math.abs(b.diff) : 0));
  // The average covers complete days only: the last 7 for this week, the whole week for an older one.
  const current = monday === weekStart(data.today);
  const end = current ? addDays(data.today, -1) : addDays(monday, 6);
  const done = Array.from({ length: 7 }, (_, i) => dayBalance(data.items, addDays(end, -i), data.today)).filter((b): b is NonNullable<typeof b> => !!b);
  const avg = done.length >= 2 ? Math.round(done.reduce((n, b) => n + b.diff, 0) / done.length / 10) * 10 : null;
  return <>
    <div className="week" role="group" aria-label="选择日期">
      <button className="week-nav" aria-label="上一周" onClick={() => setDate(addDays(date, -7))}><ChevronLeft /></button>
      {days.map((d, i) => {
        const b = balances[i];
        const tone = b ? `${b.diff < 0 === cutting ? "good" : "hold"}${b.estimate ? " est" : ""}` : "";
        return <button key={d} disabled={d > data.today} aria-pressed={d === date}
          aria-label={`${dayLabel(d)} ${b ? `${b.diff <= 0 ? "缺口" : "盈余"} ${Math.abs(b.diff)} kcal` : "没有消耗数据"}`}
          className={`day${d === date ? " selected" : ""}${d === data.today ? " today" : ""}`} onClick={() => setDate(d)}>
          <span className="day-name">{weekday(d).slice(1)}</span>
          <span className="dbar"><i className={tone} style={{ height: b ? `${Math.max(10, Math.abs(b.diff) / scale * 100)}%` : 0 }} /></span>
          <span className="day-num">{Number(d.slice(8))}</span>
        </button>;
      })}
      <button className="week-nav" aria-label="下一周" disabled={addDays(monday, 7) > data.today} onClick={() => setDate(addDays(date, 7) > data.today ? data.today : addDays(date, 7))}><ChevronRight /></button>
    </div>
    {avg !== null && <p className="week-note">{current ? "近 7 天" : "这周"}日均{avg <= 0 ? "缺口" : "盈余"} {kcal(Math.abs(avg))} kcal · 约每周 {signed(avg * 7 / 7700, 1)} kg</p>}
  </>;
}

/** The chosen day: energy in, protein/fat/carbs against the day's targets, and the balance with what was burned. */
function DayIntake() {
  const { data, date } = useApp();
  const foods = data.items.filter((i): i is Food => i.kind === "food" && i.date === date);
  if (!foods.length) return <Empty title={date === data.today ? "今天还没有饮食记录" : "这一天没有饮食记录"}>在“今天”里说吃了什么，或者拍张照。</Empty>;
  const totals = dailyTotals(data.items, date);
  const target = nutritionTargets(data.items, date, data.today, data.settings, data.dayTypes);
  const plan = target.fromPlan ? planTargets(target.type, data.settings) : null;
  const known = (key: "fat" | "carbs") => foods.some(f => f[key] != null) ? totals[key] : null;
  const macros = [
    { label: "蛋白质", value: totals.protein as number | null, want: target.protein ?? null, over: false },
    { label: "脂肪", value: known("fat"), want: plan?.fat ?? null, over: true },
    { label: "碳水", value: known("carbs"), want: plan?.carbs ?? null, over: true },
  ];
  const balance = dayBalance(data.items, date, data.today);
  const cutting = data.settings.phase !== "lean_gain";
  return <>
    <div className="hero">
      <div className="hero-label">摄入{target.kcal ? ` · 目标 ${kcal(target.kcal)}` : ""}</div>
      <div className="hero-value">{kcal(totals.calories)}<span className="hero-unit">kcal</span></div>
    </div>
    <div className="macros">{macros.map(m => {
      const ratio = m.value !== null && m.want ? m.value / m.want : null;
      return <div key={m.label} className="macro">
        <span className="macro-label">{m.label}</span>
        <span className="macro-value">{m.value === null ? "—" : Math.round(m.value)}<small>{m.want ? ` / ${m.want} g` : " g"}</small></span>
        <span className="macro-track"><i className={m.over && ratio !== null && ratio > 1.1 ? "over" : ""} style={{ width: `${ratio === null ? 0 : Math.min(100, ratio * 100)}%` }} /></span>
      </div>;
    })}</div>
    {balance ? <div className={`balance ${balance.diff < 0 === cutting ? "good" : "hold"}`}>
      <span>{balance.estimate ? "预计消耗" : "消耗"} {kcal(balance.expenditure)}{balance.source === "trend" ? " · 按体重变化反推" : ""}</span>
      <strong>{balance.diff <= 0 ? "缺口" : "盈余"} {kcal(Math.abs(balance.diff))} kcal</strong>
    </div> : <div className="balance pending"><span>缺口 / 盈余</span><span>{pendingBalance(data.items, date, data.today)}</span></div>}
  </>;
}

/** Why there is no balance yet, and when it will appear: it needs the Watch's resting + active energy. */
function pendingBalance(items: LogItem[], date: string, today: string) {
  const watched = (d: string) => dailyHealthValue(items, d, "basalEnergyKcal") !== null && dailyHealthValue(items, d, "activeEnergyKcal") !== null;
  if (date < today) return "这天没有手表的消耗数据";
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, -(i + 1))).filter(watched).length;
  return days ? `再戴表 ${3 - days} 天，显示今天的预计值` : "戴表一整天，当晚同步后显示";
}

/**
 * The day's meals as a small table. Plan meals are implied where nothing else was reported; a reported meal
 * replaces its slot and extras come after. Tapping a plan meal starts a message about it on 今天.
 */
function MealsTable() {
  const { data, date, actions } = useApp();
  const foods = data.items.filter((i): i is Food => i.kind === "food" && i.date === date);
  if (!foods.length) return null;
  const target = nutritionTargets(data.items, date, data.today, data.settings, data.dayTypes);
  const totals = dailyTotals(data.items, date);
  const rows = [
    // Within a meal: what is left of the plan first, then what the user swapped in.
    ...SLOTS.flatMap(slot => foods.filter(f => (isPlanned(f) && f.time === slot) || (!isPlanned(f) && slotOf(f) === slot)).sort((a, b) => Number(isPlanned(b)) - Number(isPlanned(a))).map(f => ({ f, slot: slot as string }))),
    ...foods.filter(f => !isPlanned(f) && slotOf(f) === null).map(f => ({ f, slot: "加餐" })),
  ];
  const cell = (value: number | null | undefined) => value == null ? "—" : Math.round(value);
  const sum = (key: "fat" | "carbs") => foods.every(f => f[key] == null) ? null : totals[key];
  const plan = target.fromPlan ? planTargets(target.type, data.settings) : null;
  const differs = plan && (Math.round(totals.calories) !== plan.kcal || Math.round(totals.protein) !== plan.protein);
  const planned = planStart(data.settings);
  return <Section title="三餐" meta={target.fromPlan ? `${target.type === "training" ? "训练日" : "休息日"}计划` : undefined}>
    <div className="nut" role="table">
      <div className="nut-row nut-head" role="row"><span /><span>热量</span><span>蛋白</span><span>脂肪</span><span>碳水</span></div>
      {rows.map(({ f, slot }, i) => <button key={f.id} role="row" className={`nut-row${isPlanned(f) ? "" : " real"}`} onClick={() => isPlanned(f) ? actions.compose(`${f.time}吃了：`) : actions.edit(f)}>
        <span className="nut-meal"><b>{rows.findIndex(r => r.slot === slot) === i ? slot : ""}</b><i>{f.description.replace(/^(早餐|早饭|午餐|午饭|晚餐|晚饭)[：:\s]*/, "")}</i></span>
        <span>{cell(f.calories)}</span><span>{cell(f.protein)}</span><span>{cell(f.fat)}</span><span>{cell(f.carbs)}</span>
      </button>)}
      <div className="nut-row nut-total" role="row"><span>合计</span><span>{Math.round(totals.calories)}</span><span>{Math.round(totals.protein)}</span><span>{cell(sum("fat"))}</span><span>{cell(sum("carbs"))}</span></div>
      {differs && plan && <div className="nut-row nut-target" role="row"><span>计划</span><span>{plan.kcal}</span><span>{plan.protein}</span><span>{cell(plan.fat)}</span><span>{cell(plan.carbs)}</span></div>}
    </div>
    {planned && planned <= date && <p className="meal-hint">按计划自动计入 · 吃了别的，点那一餐在“今天”告诉我</p>}
  </Section>;
}

function PlanLink() {
  const { data, actions } = useApp();
  const nav = useNav();
  const plan = planOf(data.settings);
  if (!plan) return <Section title="饮食计划">
    <Note>还没有计划。把你的饮食计划（图片或文字）发到“今天”，说“这是我的饮食计划”，之后每天自动按计划算，吃了别的再说。</Note>
    <div className="btn-row" style={{ marginTop: 14 }}><button className="btn" onClick={() => actions.compose("这是我的饮食计划：")}>去发给 AI</button></div>
  </Section>;
  return <Section><div className="group">
    <Row title="饮食计划" sub={plan.name} value={`${planTargets("training", data.settings)!.kcal} / ${planTargets("rest", data.settings)!.kcal}`} chevron onClick={() => nav.push({ screen: "plan" })} />
  </div></Section>;
}

/** The plan in full: both day types with their meals, the rules, and the 14-day review adjustment. */
export function PlanScreen() {
  const { data, actions } = useApp();
  const nav = useNav();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const plan = planOf(data.settings), adjust = data.settings.dietAdjustKcal ?? 0;
  // The start date is picked first and saved with 保存, so scrolling the date wheel doesn't save every step.
  const [start, setStart] = useState(plan?.startDate ?? data.today);
  const moved = !!plan && start !== plan.startDate && start <= data.today;
  async function save(next: Settings, message: string) {
    setBusy(true);
    try { await actions.saveSettings(next); toast(message); } catch (cause) { toast(cause instanceof Error ? cause.message : "保存失败"); } finally { setBusy(false); }
  }
  if (!plan) return <Screen title="饮食计划" back="饮食" large={false}><Empty title="还没有饮食计划" /></Screen>;
  return <Screen title="饮食计划" back="饮食" large={false}
    right={moved ? <button className="text-btn strong" disabled={busy} onClick={() => void save({ ...data.settings, dietPlan: { ...plan, startDate: start } }, `已改成从 ${dayLabel(start)} 开始`)}>保存</button> : undefined}>
    <Section><div className="group">
      <Row title={plan.name} sub="每天默认按计划吃，特殊情况在“今天”里说" />
      <Row as="label" title="开始日期" sub={`今天是第 ${dayDiff(data.today, start) + 1} 天`}><input className="row-input" type="date" max={data.today} value={start} onChange={e => e.target.value && setStart(e.target.value)} /></Row>
      {adjust !== 0 && <Row title="复盘调整" value={`${adjust > 0 ? "+" : ""}${adjust} kcal/天`}><button className="btn small" disabled={busy} onClick={() => void save({ ...data.settings, dietAdjustKcal: 0 }, "已恢复原计划")}>恢复</button></Row>}
    </div><p className="footnote">换新计划：把新计划发给 AI 就会替换。</p></Section>
    {(["training", "rest"] as const).map(type => { const t = planTargets(type, data.settings)!; return <Section key={type} title={type === "training" ? "训练日" : "休息日"} meta={[`${t.kcal} kcal`, `蛋白质 ${t.protein} g`, t.fat ? `脂肪 ${t.fat} g` : "", t.carbs ? `碳水 ${t.carbs} g` : ""].filter(Boolean).join(" · ")}>
      {planMeals(type, data.settings).map(m => <div key={m.slot} className="entry"><span className="entry-main"><span className="meal-slot">{m.slot}</span>{m.text}</span><span className="entry-value">{m.kcal} kcal<small className="faint"> · {m.protein} g</small></span></div>)}
    </Section>; })}
    {plan.rules.length > 0 && <Section title="规则">{plan.rules.map(rule => <p key={rule} className="footnote flush" style={{ marginBottom: 6 }}>{rule}</p>)}</Section>}
    <p className="footnote">每餐热量是估算值，已按计划的每日目标校准。</p>
    <button className="btn ghost" disabled={busy} onClick={() => { if (confirm("删除饮食计划？以后的日子不再自动按计划算，已经过去的日子也不再显示计划的饭。")) void save({ ...data.settings, dietPlan: null, dietAdjustKcal: 0 }, "已删除饮食计划").then(() => nav.pop()); }}>删除饮食计划</button>
  </Screen>;
}
