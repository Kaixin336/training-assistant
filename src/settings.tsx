import { useEffect, useRef, useState } from "react";
import { Activity, Bot, Check, Copy, Download, FileJson, HardDriveDownload, LogOut, Smartphone, Target, TrendingUp, UtensilsCrossed } from "lucide-react";
import { planMeals, planOf, planTargets } from "@/lib/diet";
import { settingsSchema, type Settings } from "@/lib/domain";
import { MAX_HEALTH_IMPORT_BYTES, type HealthConnectionStatus, type HealthTokenResponse } from "@/lib/health-types";
import { api, postJson, storageGet, storageSet } from "./api";
import { applyRestore, buildBackup, readBackup, saveFile, type RestorePlan } from "./backup";
import { useApp } from "./context";
import { kindLabels, phaseFocus, phaseLabels } from "./labels";
import { dayLabel, phaseWeek } from "./metrics";
import { applyTheme, type ThemeChoice } from "./theme";
import { Note, Row, Screen, Section, Segmented, useNav, useToast } from "./ui";

const LAST_BACKUP = "kai-last-backup";
const when = (iso: string | null) => iso ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Pacific/Auckland", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)) : null;
const daysAgo = (iso: string | null) => iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400000) : null;

// The in-app "立即同步" button runs the Shortcut by this name.
const SHORTCUT_NAME = "同步健康";
const HISTORY_BATCH_DAYS = 60;
const HISTORY_BATCH_WORKOUTS = 100;

const standalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function SettingsScreen() {
  const { data, actions } = useApp();
  const nav = useNav();
  const [health, setHealth] = useState<HealthConnectionStatus | null>(null);
  useEffect(() => { api<HealthConnectionStatus>("/api/health/status").then(setHealth).catch(() => {}); }, []);
  const goals = (["weightGoal", "waistGoal", "calorieTarget", "proteinMin", "stepTarget", "sleepMin"] as const).filter(k => data.settings[k] !== null).length;
  const backupAge = daysAgo(storageGet(LAST_BACKUP));
  const week = phaseWeek(data);
  const [theme, setTheme] = useState<ThemeChoice>(() => { const saved = storageGet("kai-theme"); return saved === "light" || saved === "dark" ? saved : "system"; });
  return <Screen root title="设置">
    <Section><div className="group">
      <Row icon={<TrendingUp />} title="训练阶段" value={`${phaseLabels[data.settings.phase]}${week ? ` · 第 ${week} 周` : ""}`} chevron onClick={() => nav.push({ screen: "phase" })} />
      <Row icon={<Target />} title="个人目标" value={goals ? `${goals} 项` : "可选"} chevron onClick={() => nav.push({ screen: "goals" })} />
      <Row icon={<UtensilsCrossed />} title="饮食计划" value={planOf(data.settings) ? `训练日 ${planTargets("training", data.settings)!.kcal} · 休息日 ${planTargets("rest", data.settings)!.kcal}` : "未设置"} chevron onClick={() => nav.push({ screen: "diet" })} />
    </div></Section>
    <Section><div className="group">
      <Row icon={<Bot />} title="AI 助手" value={data.aiEnabled ? <span className="up">已连接</span> : "未连接"} chevron onClick={() => nav.push({ screen: "ai" })} />
      <Row icon={<Activity />} title="Apple 健康" value={health?.lastSyncAt ? `${dayLabel(health.lastSyncAt.slice(0, 10))}同步` : "去设置"} chevron onClick={() => nav.push({ screen: "health" })} />
    </div></Section>
    <Section title="外观">
      <Segmented label="外观" value={theme} onChange={choice => { setTheme(choice); applyTheme(choice); }} options={[{ value: "light", label: "浅色" }, { value: "dark", label: "深色" }, { value: "system", label: "跟随系统" }]} />
    </Section>
    <Section><div className="group">
      <Row icon={<HardDriveDownload />} title="备份与导出" value={backupAge === null ? "从未备份" : backupAge === 0 ? "今天已备份" : `${backupAge} 天前`} chevron onClick={() => nav.push({ screen: "data" })} />
      {!standalone() && <Row icon={<Smartphone />} title="添加到主屏幕" chevron onClick={() => nav.push({ screen: "install" })} />}
    </div>
    {backupAge !== null && backupAge > 30 && <p className="footnote">上次备份已超过一个月。</p>}</Section>
    <Section><div className="group"><Row danger icon={<LogOut />} title="退出登录" onClick={() => void actions.signOut()} /></div>
      <p className="footnote">记录保存在你自己的 Cloudflare 账户里，按奥克兰时间归档。服务器另外自动保留最近 7 天的数据库快照。</p></Section>
  </Screen>;
}

export function PhaseScreen() {
  const { data, actions } = useApp();
  const nav = useNav();
  const [phase, setPhase] = useState(data.settings.phase);
  const [start, setStart] = useState(data.settings.phaseStart ?? data.today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changed = phase !== data.settings.phase;
  async function save() {
    setBusy(true); setError("");
    try { await actions.saveSettings({ ...data.settings, phase, phaseStart: start }); nav.pop(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败"); }
    finally { setBusy(false); }
  }
  const history = [...(data.settings.phaseHistory ?? [])].reverse();
  return <Screen title="训练阶段" back="设置" large={false} right={<button className="text-btn strong" disabled={busy || (!changed && start === data.settings.phaseStart)} onClick={() => void save()}>保存</button>}>
    <Section><div className="group">{(["fat_loss", "maintenance", "lean_gain"] as const).map(p => <Row key={p} title={phaseLabels[p]} onClick={() => { setPhase(p); setStart(p === data.settings.phase ? data.settings.phaseStart ?? data.today : data.today); }}>{phase === p && <Check className="radio-mark" />}</Row>)}</div>
      <p className="footnote">{phaseFocus[phase]}</p></Section>
    <Section><div className="group"><Row as="label" title="开始日期"><input className="row-input" type="date" max={data.today} value={start} onChange={e => setStart(e.target.value)} /></Row></div>
      {changed && <p className="footnote">保存后开始新阶段。之前的记录和阶段历史都会保留；图表和周报会在切换日期处分开比较。</p>}</Section>
    {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
    {history.length > 0 && <Section title="历史"><div className="group">{history.map((h, i) => {
      // Each phase ends where the next (newer) one starts; the newest runs until today.
      const end = i === 0 ? data.today : history[i - 1].startDate;
      const summarise = () => { void actions.send(`总结一下我${phaseLabels[h.phase]}（${h.startDate} 到 ${end}）：体重 7 日均值、腰围和主要动作力量的变化，做得好的地方，以及接下来该怎么调整。`); actions.openTab("today"); };
      return <Row key={h.startDate} title={phaseLabels[h.phase]} sub={`${h.startDate} 起`}><button className="btn small" onClick={summarise}>AI 总结</button></Row>;
    })}</div>
    <p className="footnote">“AI 总结”会把这一段的数据交给 AI，回答显示在“今天”页的输入框上方。</p></Section>}
  </Screen>;
}

type GoalKey = "weightGoal" | "waistGoal" | "calorieTarget" | "proteinMin" | "proteinMax" | "stepTarget" | "sleepMin";
const goalFields: { key: GoalKey; label: string; unit: string; step: number }[] = [
  { key: "weightGoal", label: "体重目标", unit: "kg", step: .1 }, { key: "waistGoal", label: "腰围目标", unit: "cm", step: .1 },
  { key: "calorieTarget", label: "每日热量", unit: "kcal", step: 10 }, { key: "proteinMin", label: "蛋白质下限", unit: "g", step: 1 }, { key: "proteinMax", label: "蛋白质上限", unit: "g", step: 1 },
  { key: "stepTarget", label: "每日步数", unit: "步", step: 500 }, { key: "sleepMin", label: "最少睡眠", unit: "小时", step: .5 },
];
export function GoalsScreen() {
  const { data, actions } = useApp();
  const nav = useNav();
  const [form, setForm] = useState<Settings>(data.settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    const parsed = settingsSchema.safeParse(form);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "请检查数值范围"); return; }
    setBusy(true); setError("");
    try { await actions.saveSettings(parsed.data); nav.pop(); } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败"); } finally { setBusy(false); }
  }
  return <Screen title="个人目标" back="设置" large={false} right={<button className="text-btn strong" disabled={busy} onClick={() => void save()}>保存</button>}>
    <Section><div className="group">{goalFields.map(f => <Row key={f.key} as="label" title={f.label}>
      <input className="row-input" type="number" inputMode="decimal" step={f.step} placeholder="未设置" value={form[f.key] ?? ""} onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value === "" ? null : Number(e.target.value) }))} />
      <span className="faint" style={{ fontSize: 14, width: 34 }}>{f.unit}</span>
    </Row>)}</div>
    <p className="footnote">全部可以留空。设置后会出现在图表的目标线、周报和提醒里；没设置的目标不会被代填。</p></Section>
    <Section title="训练节奏">
      <Segmented label="训练节奏" value={form.trainingPattern ?? "alternate"} onChange={value => setForm(prev => ({ ...prev, trainingPattern: value }))} options={[{ value: "alternate", label: "练一休一" }, { value: "free", label: "不固定" }]} />
      <p className="footnote flush">练一休一时，没练的第二天自动算训练日，饮食按训练日计划；“今天”页左上角可以随时手动切换。</p>
    </Section>
    <Section title="力量水平参考">
      <Segmented label="力量标准" value={form.strengthSex ?? "none"} onChange={value => setForm(prev => ({ ...prev, strengthSex: value === "none" ? null : value }))} options={[{ value: "male", label: "男性标准" }, { value: "female", label: "女性标准" }, { value: "none", label: "不显示" }]} />
    </Section>
    {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
  </Screen>;
}

export function DietScreen() {
  const { data, actions } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const plan = planOf(data.settings), adjust = data.settings.dietAdjustKcal ?? 0;
  async function save(next: Settings, message: string) {
    setBusy(true);
    try { await actions.saveSettings(next); toast(message); } catch (cause) { toast(cause instanceof Error ? cause.message : "保存失败"); } finally { setBusy(false); }
  }
  if (!plan) return <Screen title="饮食计划" back="设置" large={false}>
    <Note>还没有饮食计划。把你的计划（图片或文字）发给“今天”页的 AI，并说“这是我的饮食计划”，它会整理成训练日和休息日的三餐。之后每天默认按计划算，吃了别的再告诉它。</Note>
    <div className="btn-row" style={{ marginTop: 16 }}><button className="btn primary" onClick={() => actions.compose("这是我的饮食计划：")}>去发给 AI</button></div>
  </Screen>;
  return <Screen title="饮食计划" back="设置" large={false}>
    <Section><div className="group">
      <Row title={plan.name} sub={`${plan.startDate} 起 · 每天默认按计划吃，特殊情况在“今天”里说`} />
      {adjust !== 0 && <Row title="复盘调整" value={`${adjust > 0 ? "+" : ""}${adjust} kcal/天`}><button className="btn small" disabled={busy} onClick={() => void save({ ...data.settings, dietAdjustKcal: 0 }, "已恢复原计划")}>恢复</button></Row>}
    </div><p className="footnote">换新计划：把新计划发给 AI 就会替换。</p></Section>
    {(["training", "rest"] as const).map(type => { const t = planTargets(type, data.settings)!; return <Section key={type} title={type === "training" ? "训练日" : "休息日"} meta={[`${t.kcal} kcal`, `蛋白质 ${t.protein} g`, t.fat ? `脂肪 ${t.fat} g` : "", t.carbs ? `碳水 ${t.carbs} g` : ""].filter(Boolean).join(" · ")}>
      {planMeals(type, data.settings).map(m => <div key={m.slot} className="entry"><span className="entry-main"><span className="meal-slot">{m.slot}</span>{m.text}</span><span className="entry-value">{m.kcal} kcal<small className="faint"> · {m.protein} g</small></span></div>)}
    </Section>; })}
    {plan.rules.length > 0 && <Section title="规则">{plan.rules.map(rule => <p key={rule} className="footnote flush" style={{ marginBottom: 6 }}>{rule}</p>)}</Section>}
    <p className="footnote">每餐热量是估算值，已按计划的每日目标校准。</p>
    <button className="btn ghost" disabled={busy} onClick={() => { if (confirm("删除饮食计划？以后的日子不再自动按计划算，已经过去的日子也不再显示计划的饭。")) void save({ ...data.settings, dietPlan: null, dietAdjustKcal: 0 }, "已删除饮食计划"); }}>删除饮食计划</button>
  </Screen>;
}

type AiStatus = { connected: boolean; model: string; environmentManaged: boolean };
export function AiScreen() {
  const { actions } = useApp();
  const toast = useToast();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("deepseek-flash");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const refresh = () => api<AiStatus>("/api/ai-config").then(s => { setStatus(s); setModel(s.model); });
  useEffect(() => { refresh().catch(e => setError(e.message)); }, []);
  async function run(label: string, task: () => Promise<{ message?: string }>) {
    setBusy(label); setError("");
    try { const r = await task(); toast(r.message ?? "完成"); await refresh(); await actions.reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败"); }
    finally { setBusy(""); }
  }
  const form = !status?.connected || editing;
  return <Screen title="AI 助手" back="设置" large={false}>
    <p className="prose" style={{ marginTop: 16 }}>连接 DeepSeek 后可以随口说：“今天练腿，深蹲 80 做了 5 组 5 个，最后两组很吃力，晚饭牛肉面。”也能问“这周卧推怎么样”。拆出的每条记录都会先校验再保存，看不懂的会先问你。</p>
    {!status ? <p className="faint" style={{ marginTop: 16 }}>正在读取…</p> : status.environmentManaged ? <Section><div className="group">
        <Row title="状态" value={<span className="up">已连接</span>} />
        <Row title="模型" value={status.model} />
        <Row title={busy === "test" ? "正在测试…" : "测试连接"} onClick={() => void run("test", () => postJson("/api/ai-config/test", {}))} />
      </div><p className="footnote">API key 已作为加密密钥保存在 Cloudflare，不需要在这里填写。</p></Section> : <>
      {status.connected && <Section><div className="group">
        <Row title="状态" value={<span className="up">已连接</span>} />
        <Row title="模型" value={status.model} />
        <Row title={busy === "test" ? "正在测试…" : "测试连接"} onClick={() => void run("test", () => postJson("/api/ai-config/test", {}))} />
        <Row title="更换 key 或模型" onClick={() => setEditing(true)} />
        <Row danger title="断开" onClick={() => { if (confirm("断开后回到基础格式记录，已保存的记录不受影响。")) void run("delete", () => api("/api/ai-config", { method: "DELETE" })); }} />
      </div></Section>}
      {form && <Section title={status.connected ? "更换" : "连接"}>
        <form className="form" onSubmit={e => { e.preventDefault(); void run("save", async () => { const r = await postJson<{ message: string }>("/api/ai-config", { apiKey: key.trim(), model }); setKey(""); setEditing(false); return r; }); }}>
          <label className="field"><span className="field-label">API key</span><input className="input mono" type="password" autoComplete="off" spellCheck={false} placeholder="sk-…" value={key} onChange={e => setKey(e.target.value)} /></label>
          <div className="field"><span className="field-label">模型</span><Segmented label="模型" value={model} onChange={setModel} options={[{ value: "deepseek-flash", label: "Flash · 快、便宜" }, { value: "deepseek-v4-pro", label: "Pro · 更强" }]} /></div>
          <button className="btn primary block" disabled={!!busy || key.trim().length < 16}>{busy === "save" ? "正在保存…" : "加密保存"}</button>
          {editing && <button type="button" className="btn block" onClick={() => { setEditing(false); setKey(""); }}>取消</button>}
        </form>
        <p className="footnote flush">在 <a className="link" href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">DeepSeek 开放平台</a> 创建 key 并充值少量余额。key 用服务器密钥加密后存进你的数据库，之后不会再显示，也不会存在手机里。</p>
      </Section>}
    </>}
    {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
    <p className="footnote flush" style={{ marginTop: 24 }}>隐私：每条消息会连同最近的训练、饮食、身体记录（不含照片）发给 DeepSeek 作为上下文。照片和访问口令永远不会发送。</p>
  </Screen>;
}

export function HealthScreen() {
  const { data, actions } = useApp();
  const toast = useToast();
  const [status, setStatus] = useState<HealthConnectionStatus | null>(null);
  const [progress, setProgress] = useState("");
  const historyInput = useRef<HTMLInputElement>(null);
  const [connection, setConnection] = useState<HealthTokenResponse | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const refresh = () => api<HealthConnectionStatus>("/api/health/status").then(setStatus);
  // The sync token is created on first visit and stays retrievable, so there is nothing to generate by hand.
  useEffect(() => {
    refresh().catch(() => {}); postJson<HealthTokenResponse>("/api/health/token", { rotate: false }).then(setConnection).catch(e => setError(e.message));
    // Coming back from the Shortcuts app should show the new sync time.
    const visible = () => { if (document.visibilityState === "visible") refresh().catch(() => {}); };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, []);
  async function rotate() {
    if (!confirm("换一个新令牌后，快捷指令里的旧地址会失效，需要重新粘贴同步地址。")) return;
    setBusy("token"); setError("");
    try { setConnection(await postJson<HealthTokenResponse>("/api/health/token", { rotate: true })); toast("已换新令牌"); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败"); } finally { setBusy(""); }
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    setBusy("import"); setError(""); setWarnings([]);
    try {
      if (file.size > MAX_HEALTH_IMPORT_BYTES) throw new Error("文件超过 5 MB，请缩短导出的日期范围。");
      let payload: unknown; try { payload = JSON.parse(await file.text()); } catch { throw new Error("这不是有效的 JSON 文件。"); }
      const r = await postJson<{ imported: number; warnings?: string[] }>("/api/health/import", payload);
      setWarnings(r.warnings ?? []); toast(`已导入 ${r.imported} 条`);
      await Promise.all([refresh(), actions.reload()]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "导入失败"); }
    finally { setBusy(""); if (fileInput.current) fileInput.current.value = ""; }
  }
  async function importHistory(file: File | undefined) {
    if (!file) return;
    setBusy("history"); setError(""); setWarnings([]); setProgress("正在读取…");
    try {
      const { readHealthExport } = await import("./health-history");
      let shown = -1;
      const history = await readHealthExport(file, (done, total) => {
        const percent = Math.min(99, Math.floor(done / total * 100));
        if (percent !== shown) { shown = percent; setProgress(`正在读取 ${percent}%`); }
      });
      const days = history.days.filter(day => day.date <= data.today), workouts = history.workouts.filter(w => w.date <= data.today);
      if (!days.length && !workouts.length) throw new Error("文件里没有找到体重、腰围或运动记录。");
      // Small batches keep each request well inside the free database's per-request query limit.
      const batches = [
        ...Array.from({ length: Math.ceil(days.length / HISTORY_BATCH_DAYS) }, (_, i) => ({ days: days.slice(i * HISTORY_BATCH_DAYS, (i + 1) * HISTORY_BATCH_DAYS) })),
        ...Array.from({ length: Math.ceil(workouts.length / HISTORY_BATCH_WORKOUTS) }, (_, i) => ({ workouts: workouts.slice(i * HISTORY_BATCH_WORKOUTS, (i + 1) * HISTORY_BATCH_WORKOUTS) })),
      ];
      for (const [index, batch] of batches.entries()) {
        setProgress(`正在保存 ${index + 1}/${batches.length}`);
        await postJson("/api/health/import", { source: "apple-shortcuts", ...batch });
      }
      toast(`已导入体重 ${days.filter(d => d.weightKg).length} 天、腰围 ${days.filter(d => d.waistCm).length} 天、运动 ${workouts.length} 次`);
      await Promise.all([refresh(), actions.reload()]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "导入失败"); }
    finally { setBusy(""); setProgress(""); if (historyInput.current) historyInput.current.value = ""; }
  }
  const copy = async (text: string, label: string) => { try { await navigator.clipboard.writeText(text); toast(`已复制${label}`); } catch { setError("无法自动复制，请长按选择后复制。"); } };
  // The token rides in the address so the Shortcut needs no header.
  const address = connection ? `${connection.endpoint}?key=${connection.token}` : "";
  return <Screen title="Apple 健康" back="设置" large={false}>
    <div className="group" style={{ marginTop: 16 }}>
      <Row title="上次同步" value={status ? when(status.lastSyncAt) ?? "还没有" : "…"} />
    </div>
    <a className="btn block" style={{ marginTop: 12 }} href={`shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}`}><Activity />立即同步</a>
    <p className="footnote">iPhone 不允许网页直接读取“健康”。用自带的“快捷指令”搭一次，之后每晚自动同步步数、体重和腰围。“立即同步”会运行名为“{SHORTCUT_NAME}”的快捷指令。</p>
    <Section title="第 1 步 · 复制同步地址">
      <div className="group">
        <Row title="同步地址" sub={connection ? `${connection.endpoint}?key=${connection.token.slice(0, 6)}…` : "正在准备…"}><button className="btn small" disabled={!connection} onClick={() => void copy(address, "同步地址")}><Copy />复制</button></Row>
      </div>
      <p className="footnote">新加的“查找健康样本”会自动变成“筛选…健康样本”：点那个带 ❤️ 的“健康样本”，选“清除变量”就变回“查找”。</p>
      <p className="footnote">地址里带着同步令牌，只能写入健康数据，读不到你的其它记录。别发给别人。</p>
    </Section>
    <Section title="第 2 步 · 在快捷指令里新建">
      <a className="btn primary block" href="shortcuts://create-shortcut">打开快捷指令</a>
      <ol className="steps" style={{ marginTop: 16 }}>
        <li>添加“<strong>查找健康样本</strong>”：类型选<strong>步数</strong>，条件“开始日期 是 今天”，再添加筛选条件“<strong>来源 是 你的 Apple Watch</strong>”（否则手机和手表的步数会相加）；<strong>分组方式选“天”</strong>，关掉“填写缺失项”和“<strong>限制</strong>”。</li>
        <li>再添加一个“<strong>查找健康样本</strong>”：类型选<strong>体重</strong>，条件“开始日期 是 今天”，单位“公斤”，排序方式“开始日期”、顺序“最新优先”，限制 1 个。<strong>腰围</strong>同样再加一个（单位“厘米”）。</li>
        <li>添加“<strong>获取 URL 内容</strong>”：网址粘贴同步地址；展开，方法选 <strong>POST</strong>，请求体选 <strong>JSON</strong>，加字段：<code className="mono">steps</code> 选步数的健康样本，<code className="mono">weight</code> 选体重的，<code className="mono">waist</code> 选腰围的。</li>
        <li>添加“<strong>显示结果</strong>”，把快捷指令命名为“<strong>{SHORTCUT_NAME}</strong>”，点 ▶ 运行一次。看到“已同步”就成功了。</li>
      </ol>
    </Section>
    <Section title="第 3 步 · 每晚自动运行">
      <ol className="steps">
        <li>快捷指令底部点“<strong>自动化</strong>” › 右上角 ＋ › “<strong>特定时间</strong>”。</li>
        <li>时间 <strong>22:00</strong>，重复“<strong>每天</strong>”，选“<strong>立即运行</strong>” › 下一步 › 选“{SHORTCUT_NAME}”。</li>
      </ol>
      <p className="footnote flush">手机锁着时 iOS 不让读健康数据，那一次会同步不到。重复同步只会覆盖当天的数据，不会重复记录；漏了就点上面的“立即同步”。</p>
      <p className="footnote flush">想多同步几项，在请求体里再加字段即可：<code className="mono">activeEnergy</code>（活动能量，按天分组）、<code className="mono">restingHeartRate</code>（静息心率）、<code className="mono">hrv</code>、<code className="mono">exerciseMinutes</code>。没有数据的那天会自动跳过，不会记成 0。</p>
    </Section>
    <Section title="导入以前的数据">
      <ol className="steps">
        <li>打开<strong>健康</strong> App › 右上角头像 › 最下面“<strong>导出所有健康数据</strong>” › 导出，等它准备好。</li>
        <li>选“<strong>存储到“文件”</strong>”。</li>
        <li>回到这里点下面，选刚才存的那个压缩包（“导出.zip”）。</li>
      </ol>
      <label className="upload" style={{ marginTop: 8, opacity: busy && busy !== "history" ? .5 : 1 }}><HardDriveDownload size={24} /><strong>{busy === "history" ? progress : "选择健康导出文件"}</strong><span>体重、腰围和 Apple Watch 运动（类型、时长、心率、强度）· 只在手机上读取</span>
        <input ref={historyInput} type="file" accept=".zip,.xml,application/zip,application/xml,text/xml" disabled={!!busy} onChange={e => void importHistory(e.target.files?.[0])} /></label>
      <p className="footnote flush">体重和腰围出现在“身体”页的曲线里，运动出现在每天的记录里。重复导入只会覆盖，不会重复；以后想补最近的运动，再导出导入一次就行。</p>
    </Section>
    <Section title="可选 · 运动识别和早晨状态">
      <p className="footnote flush">都在同一个“同步健康”里加“查找健康样本”（开始日期“是今天”），再在 JSON 里加字段。新加的卡片变成“筛选”时，点 ❤️ 健康样本 › 清除变量。</p>
      <ol className="steps" style={{ marginTop: 10 }}>
        <li><strong>运动识别</strong>：心率（分组 无、限制 关）→ <code className="mono">hr</code> 取“值”、<code className="mono">hrTime</code> 取“开始日期”。可再加活动能量 <code className="mono">kcal</code>/<code className="mono">kcalTime</code>、手表步数（分组 无）<code className="mono">stepList</code>/<code className="mono">stepTime</code>。</li>
        <li><strong>HRV</strong>：心率变异性（分组 无、限制 关）→ <code className="mono">hrv</code>。</li>
        <li><strong>静息心率</strong>：静息心率（开始日期排序、最新的排最前、限制 1）→ <code className="mono">restingHeartRate</code>。</li>
        <li><strong>手腕温度</strong>：手腕温度（同上，限制 1）→ <code className="mono">wristTemp</code>。需要戴表睡觉并开启睡眠专注模式。</li>
        <li><strong>睡眠</strong>：睡眠分析，把条件改成“<strong>结束日期 是今天</strong>”（分组 无、限制 关）→ <code className="mono">sleepStage</code> 取“值”、<code className="mono">sleepStart</code> 取“开始日期”、<code className="mono">sleepEnd</code> 取“结束日期”。</li>
      </ol>
      <p className="footnote flush">有了这些，“今天”页早上会显示身体状态，周报里会显示训练负荷。哪项没加就跳过哪项。</p>
    </Section>
    <Section>
      <details>
        <summary className="section-title" style={{ cursor: "pointer", minHeight: 40, display: "flex", alignItems: "center" }}>其他方式：导入文件、换令牌</summary>
        <label className="upload" style={{ marginTop: 8, opacity: busy === "import" ? .5 : 1 }}><FileJson size={24} /><strong>{busy === "import" ? "正在导入…" : "选择健康 JSON 文件"}</strong><span>Health Auto Export JSON 或本应用格式 · 5 MB 以内</span>
          <input ref={fileInput} type="file" accept=".json,application/json" disabled={!!busy} onChange={e => void importFile(e.target.files?.[0])} /></label>
        <button className="btn block" style={{ marginTop: 12 }} disabled={!!busy} onClick={() => void rotate()}>{busy === "token" ? "正在更换…" : "换一个新令牌"}</button>
      </details>
      {warnings.length > 0 && <Note tone="hold">{warnings.join(" ")}</Note>}
    </Section>
    {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
  </Screen>;
}

/** Weekly backup into iCloud Drive by a Shortcut automation; the link can only read an export. */
function AutoBackup() {
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  async function load(rotate = false) {
    setError("");
    try { setUrl((await postJson<{ url: string }>("/api/backup/token", { rotate })).url); if (rotate) toast("已换新链接，旧链接失效"); } catch (cause) { setError(cause instanceof Error ? cause.message : "生成失败"); }
  }
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast("已复制备份链接"); } catch { setError("无法自动复制，请长按选择后复制。"); } };
  return <Section title="每周自动备份到 iCloud">
    {url ? <div className="group"><Row title="备份链接" sub={`${url.slice(0, 48)}…`}><button className="btn small" onClick={() => void copy()}><Copy />复制</button></Row></div>
      : <button className="btn block" onClick={() => void load()}>生成备份链接</button>}
    <ol className="steps" style={{ marginTop: 12 }}>
      <li>快捷指令 › 自动化 › ＋ › “<strong>特定时间</strong>”：每周日 21:00，选“立即运行”。</li>
      <li>新建快捷指令，加“<strong>获取 URL 内容</strong>”，网址粘贴备份链接（方法保持 GET）。</li>
      <li>再加“<strong>存储文件</strong>”：存到 iCloud 云盘，关掉“询问存储位置”，子路径填 <code className="mono">训练助手备份/</code>。</li>
    </ol>
    <p className="footnote flush">备份不含照片原图（照片请偶尔用上面的“下载完整备份”）。链接只能读取备份，泄露了可以点下面换一个。</p>
    {url && <button className="btn ghost" onClick={() => void load(true)}>换一个新链接</button>}
    {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
  </Section>;
}

export function DataScreen() {
  const { actions } = useApp();
  const toast = useToast();
  const [includePhotos, setIncludePhotos] = useState(true);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [includeSettings, setIncludeSettings] = useState(false);
  const [lastBackup, setLastBackup] = useState(storageGet(LAST_BACKUP));
  const input = useRef<HTMLInputElement>(null);
  async function backup() {
    setError("");
    try {
      const { blob, name } = await buildBackup(includePhotos, setProgress); saveFile(blob, name);
      const now = new Date().toISOString(); storageSet(LAST_BACKUP, now); setLastBackup(now);
      toast(`备份已生成 · ${(blob.size / 1048576).toFixed(1)} MB`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "备份失败"); } finally { setProgress(""); }
  }
  async function choose(file: File | undefined) {
    setPlan(null); setError(""); if (!file) return;
    try { setPlan(readBackup(await file.text())); } catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取这个文件"); }
  }
  async function restore() {
    if (!plan) return; setError("");
    try {
      const r = await applyRestore(plan, includeSettings, setProgress);
      toast(`已恢复 ${r.items} 条记录、${r.photos} 张照片`); setPlan(null); if (input.current) input.current.value = ""; await actions.reload();
    } catch (cause) { setError(`${cause instanceof Error ? cause.message : "恢复中断"}。已恢复的部分会保留，再次恢复同一文件不会重复。`); }
    finally { setProgress(""); }
  }
  return <Screen title="备份与恢复" back="设置" large={false}>
    <Section title="备份" meta={lastBackup ? `上次 ${when(lastBackup)}` : "还没有备份过"}>
      <div className="group">
        <Row as="label" title="包含照片原图" sub="文件会比较大"><input className="switch" type="checkbox" checked={includePhotos} onChange={e => setIncludePhotos(e.target.checked)} /></Row>
      </div>
      <button className="btn primary block" style={{ marginTop: 12 }} disabled={!!progress} onClick={() => void backup()}><Download />{progress && !plan ? progress : "下载完整备份"}</button>
      <p className="footnote flush">包含所有记录、对话、阶段和目标。建议每月一次，存到“文件”或电脑里。</p>
      <a className="btn block" style={{ marginTop: 10 }} href="/api/export?format=csv"><Download />导出表格 CSV</a>
    </Section>
    <AutoBackup />
    <Section title="从备份恢复">
      <label className="upload"><FileJson size={24} /><strong>选择备份文件</strong><span>先显示内容，确认后才写入</span><input ref={input} type="file" accept=".json,application/json" disabled={!!progress} onChange={e => void choose(e.target.files?.[0])} /></label>
      {plan && <>
        <div className="group" style={{ marginTop: 12 }}>
          <Row title="备份时间" value={when(plan.exportedAt)} />
          <Row title="记录" value={`${plan.items.length + plan.photos.length} 条`} sub={Object.entries(plan.counts).map(([k, n]) => `${kindLabels[k as keyof typeof kindLabels] ?? k} ${n}`).join(" · ")} />
          {plan.firstDate && <Row title="日期范围" value={`${plan.firstDate} – ${plan.lastDate}`} />}
          <Row title="照片原图" value={`${plan.photos.filter(p => p.file).length}/${plan.photos.length}`} />
          <Row as="label" title="同时恢复阶段和目标"><input className="switch" type="checkbox" checked={includeSettings} onChange={e => setIncludeSettings(e.target.checked)} /></Row>
        </div>
        {plan.invalid > 0 && <p className="footnote flush">{plan.invalid} 条格式无效，将跳过。</p>}
        <div className="btn-row" style={{ marginTop: 12 }}><button className="btn" onClick={() => { setPlan(null); if (input.current) input.current.value = ""; }}>取消</button><button className="btn primary" disabled={!!progress} onClick={() => void restore()}>{progress || "确认恢复"}</button></div>
        <p className="footnote flush">同一条记录会按备份内容覆盖，不会出现重复。</p>
      </>}
    </Section>
    {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
  </Screen>;
}

export function InstallScreen() {
  const standalone = typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
  return <Screen title="添加到主屏幕" back="设置" large={false}>
    {standalone ? <Note tone="good">你正在从主屏幕图标使用训练助手。</Note> : <>
      <ol className="steps" style={{ marginTop: 20 }}>
        <li>用 iPhone 自带的 <strong>Safari</strong> 打开这个网址（微信里的浏览器不行）。</li>
        <li>点底部的 <strong>分享</strong> 按钮（方框加向上的箭头）。</li>
        <li>选 <strong>添加到主屏幕</strong>，名称保持“训练助手”，点“添加”。</li>
        <li>从主屏幕图标打开，再输入一次口令。之后 30 天内不用重新登录。</li>
      </ol>
      <p className="footnote flush" style={{ marginTop: 16 }}>不需要 App Store。需要联网；在没信号的健身房里记下的内容会先存在手机上，联网后自动发送。</p>
    </>}
  </Screen>;
}
