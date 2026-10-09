/**
 * Shortcut time text → epoch ms. Shortcuts write dates into JSON as display text in the phone's language
 * ("2026年10月9日 凌晨1:00", "Oct 9, 2026 at 1:00 AM", ISO…); times without a zone are Auckland wall time.
 */
// Sleep sends a time per stage: the (slow) Intl time-zone lookup runs once per wall-clock hour, not once per sample.
const formatters = new Map<string, Intl.DateTimeFormat>(), offsets = new Map<string, number>();
function zoneOffset(ms: number, zone: string) {
  let format = formatters.get(zone);
  if (!format) { format = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); formatters.set(zone, format); }
  const parts = format.formatToParts(new Date(ms)), get = (type: string) => Number(parts.find(p => p.type === type)!.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second")) - ms;
}
function zoned(y: number, m: number, d: number, h: number, mi: number, s: number, zone: string) {
  const key = `${zone}|${y}-${m}-${d}-${h}`;
  let offset = offsets.get(key);
  if (offset === undefined) {
    const hour = Date.UTC(y, m - 1, d, h);
    offset = zoneOffset(hour, zone);
    const corrected = zoneOffset(hour - offset, zone);
    if (corrected !== offset) offset = corrected;
    offsets.set(key, offset);
  }
  return Date.UTC(y, m - 1, d, h, mi, s) - offset;
}
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * Dates as Shortcuts writes them into text: ISO 8601, "2026年10月8日 下午6:05:12", "2026/10/8 18:05",
 * "Oct 8, 2026 at 6:05 PM" or relative "今天 18:05". Times without a zone are Auckland wall time.
 */
const FAST = /^(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})日?\s*(上午|下午|凌晨|早上|中午|晚上|傍晚)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
export function parseShortcutTime(input: string, today: string, zone = "Pacific/Auckland"): number | null {
  const text = input.trim();
  if (!text) return null;
  // Fast path for the usual "2026/10/8 下午6:05:12" / "2026年10月8日 18:05" shapes.
  const fast = FAST.exec(text);
  if (fast) {
    let hour = +fast[5];
    const mark = fast[4];
    if ((mark === "下午" || mark === "晚上" || mark === "傍晚") && hour < 12) hour += 12;
    else if (mark === "中午" && hour < 11) hour += 12;
    else if ((mark === "凌晨" || mark === "上午" || mark === "早上") && hour === 12) hour = 0;
    if (hour > 23 || +fast[6] > 59) return null;
    return zoned(+fast[1], +fast[2], +fast[3], hour, +fast[6], +(fast[7] ?? 0), zone);
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text) && /(Z|[+-]\d{2}:?\d{2})$/.test(text)) { const ms = Date.parse(text); return Number.isFinite(ms) ? ms : null; }
  let ymd: number[] | null = null;
  const numeric = text.match(/(\d{4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})/);
  const english = text.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/) ?? text.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/);
  if (numeric) ymd = [+numeric[1], +numeric[2], +numeric[3]];
  else if (english) {
    const [month, day] = /^\d/.test(english[1]) ? [english[2], english[1]] : [english[1], english[2]];
    const m = MONTHS[month.toLowerCase()]; if (m) ymd = [+english[3], m, +day];
  } else if (/今天|today/i.test(text)) ymd = today.split("-").map(Number);
  else if (/昨天|yesterday/i.test(text)) ymd = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10).split("-").map(Number);
  const time = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!ymd || !time) return null;
  let hour = +time[1];
  if (/下午|晚上|傍晚|PM/i.test(text) && hour < 12) hour += 12;
  else if (/中午/.test(text) && hour < 11) hour += 12;
  else if (/凌晨|上午|早上|AM/i.test(text) && hour === 12) hour = 0;
  if (hour > 23 || +time[2] > 59) return null;
  return zoned(ymd[0], ymd[1], ymd[2], hour, +time[2], +(time[3] ?? 0), zone);
}
