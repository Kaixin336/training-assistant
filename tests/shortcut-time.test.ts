import test from "node:test";
import assert from "node:assert/strict";
import { parseShortcutTime } from "../lib/shortcut-time";

// 2026-10-08 in Auckland is NZDT (+13:00).
const at = (hhmm: string, seconds = 0) => Date.parse(`2026-10-08T${hhmm}:00+13:00`) + seconds * 1000;

test("Shortcuts date text in Chinese, English, relative and ISO forms", () => {
  const expected = at("18:05", 12);
  assert.equal(parseShortcutTime("2026年10月8日 下午6:05:12", "2026-10-08"), expected);
  assert.equal(parseShortcutTime("2026/10/8 18:05:12", "2026-10-08"), expected);
  assert.equal(parseShortcutTime("Oct 8, 2026 at 6:05:12 PM", "2026-10-08"), expected);
  assert.equal(parseShortcutTime("8 October 2026 at 18:05:12", "2026-10-08"), expected);
  assert.equal(parseShortcutTime("今天 下午6:05:12", "2026-10-08"), expected);
  assert.equal(parseShortcutTime("2026-10-08T18:05:12+13:00", "2026-10-08"), expected);
  assert.equal(parseShortcutTime("2026年10月8日 凌晨12:07", "2026-10-08"), at("00:07"));
  assert.equal(parseShortcutTime("2026年10月8日 中午12:30", "2026-10-08"), at("12:30"));
  assert.equal(parseShortcutTime("没有时间", "2026-10-08"), null);
});
