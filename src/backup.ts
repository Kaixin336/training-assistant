import { logItemSchema, type ChatMessage, type LogItem, type Photo, type Settings, type TrainingSession } from "@/lib/domain";
import { api, postJson } from "./api";

export const BACKUP_FORMAT = "kai-training-v1";
type PhotoFile = { id: string; contentType: string; base64: string };
type Exported = { format: string; exportedAt: string; today?: string; settings: Settings; items: LogItem[]; messages: ChatMessage[]; sessions?: TrainingSession[]; photoFiles: PhotoFile[] };

function toBase64(bytes: Uint8Array) { let binary = ""; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(binary); }
function fromBase64(text: string) { const binary = atob(text); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); return bytes; }

/**
 * The server exports records only; originals are fetched one per request so that each
 * request stays inside the D1 free-plan query limit. The file is assembled in the browser.
 */
export async function buildBackup(includePhotos: boolean, progress: (text: string) => void): Promise<{ blob: Blob; name: string }> {
  progress("正在导出记录…");
  const exported = await api<Exported>("/api/export?format=json");
  const photos = exported.items.filter((i): i is Photo => i.kind === "photo");
  const files: PhotoFile[] = [];
  if (includePhotos) for (const [index, photo] of photos.entries()) {
    progress(`正在打包原图 ${index + 1}/${photos.length}…`);
    const response = await fetch(`/api/photos/${photo.id}`, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error(`第 ${index + 1} 张照片暂时无法读取，备份没有完成，请重试。`);
    files.push({ id: photo.id, contentType: photo.contentType, base64: toBase64(new Uint8Array(await response.arrayBuffer())) });
  }
  const date = exported.today ?? exported.exportedAt.slice(0, 10);
  return { blob: new Blob([JSON.stringify({ ...exported, photoFiles: files })], { type: "application/json" }), name: `kai-training-backup-${date}${includePhotos ? "" : "-no-photos"}.json` };
}

export function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export type RestorePlan = { exportedAt: string; settings: Settings; items: LogItem[]; photos: { record: Photo; file: PhotoFile | null }[]; messages: ChatMessage[]; sessions: TrainingSession[]; counts: Record<string, number>; firstDate: string | null; lastDate: string | null; invalid: number };

/** Validates locally first, so nothing is uploaded until the preview is confirmed. */
export function readBackup(text: string): RestorePlan {
  let value: Exported;
  try { value = JSON.parse(text) as Exported; } catch { throw new Error("这个文件不是有效的 JSON 备份。"); }
  if (value?.format !== BACKUP_FORMAT || !Array.isArray(value.items)) throw new Error("这不是训记导出的备份文件。");
  const files = new Map((value.photoFiles ?? []).map(file => [file.id, file]));
  const items: LogItem[] = [], photos: RestorePlan["photos"] = []; let invalid = 0;
  for (const raw of value.items) {
    // Implied diet-plan meals are never real records (older exports may contain them).
    if (typeof raw?.id === "string" && raw.id.startsWith("plan-")) continue;
    const parsed = logItemSchema.safeParse(raw);
    if (!parsed.success) { invalid++; continue; }
    if (parsed.data.kind === "photo") photos.push({ record: parsed.data, file: files.get(parsed.data.id) ?? null });
    else items.push(parsed.data);
  }
  const counts: Record<string, number> = {};
  for (const item of [...items, ...photos.map(p => p.record)]) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  const dates = [...items, ...photos.map(p => p.record)].map(i => i.date).sort();
  return { exportedAt: value.exportedAt, settings: value.settings, items, photos, messages: Array.isArray(value.messages) ? value.messages : [], sessions: Array.isArray(value.sessions) ? value.sessions : [], counts, firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null, invalid };
}

const BATCH = 100;
export async function applyRestore(plan: RestorePlan, includeSettings: boolean, progress: (text: string) => void) {
  const rounds = Math.max(1, Math.ceil(Math.max(plan.items.length, plan.messages.length) / BATCH));
  for (let round = 0; round < rounds; round++) {
    progress(`正在恢复记录 ${round + 1}/${rounds}…`);
    await postJson("/api/restore", {
      operationId: crypto.randomUUID(),
      ...(round === 0 && includeSettings && plan.settings ? { settings: plan.settings } : {}),
      items: plan.items.slice(round * BATCH, (round + 1) * BATCH),
      messages: plan.messages.slice(round * BATCH, (round + 1) * BATCH),
      sessions: round === 0 ? plan.sessions.slice(0, 60) : [],
    });
  }
  const withFiles = plan.photos.filter(p => p.file);
  for (const [index, photo] of withFiles.entries()) {
    progress(`正在恢复原图 ${index + 1}/${withFiles.length}…`);
    const form = new FormData();
    form.set("operationId", crypto.randomUUID());
    form.set("record", JSON.stringify(photo.record));
    form.set("file", new Blob([fromBase64(photo.file!.base64) as BlobPart], { type: photo.file!.contentType }), `${photo.record.id}`);
    await api("/api/restore/photo", { method: "POST", body: form });
  }
  return { items: plan.items.length, photos: withFiles.length, skipped: plan.photos.length - withFiles.length };
}
