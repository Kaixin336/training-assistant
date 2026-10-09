/** The import boundary contains Health summaries, never inferred strength sets. */
export const HEALTH_TIMEZONE = "Pacific/Auckland";
export const MAX_HEALTH_IMPORT_BYTES = 5 * 1024 * 1024;
/** API limit: each measurement and workout summary counts as one record. */
export const MAX_HEALTH_IMPORT_REQUEST_ITEMS = 400;
export const MAX_HEALTH_IMPORT_ITEMS = 5000;
export const MAX_HEALTH_SAMPLES = 30000;

export type HealthImportSource = "apple-shortcuts" | "health-auto-export";
export type HealthDayField =
  | "steps" | "sleepH" | "weightKg" | "activeEnergyKcal"
  | "restingHeartRate" | "hrvMs" | "exerciseMin" | "waistCm" | "wristTempC" | "basalEnergyKcal";

export interface ShortcutHealthDay {
  date: string;
  steps?: number | null;
  sleepH?: number | null;
  weightKg?: number | null;
  activeEnergyKcal?: number | null;
  restingHeartRate?: number | null;
  hrvMs?: number | null;
  exerciseMin?: number | null;
  waistCm?: number | null;
  /** Overnight wrist temperature (absolute °C); compared with the personal baseline. */
  wristTempC?: number | null;
  basalEnergyKcal?: number | null;
}

export interface ShortcutHealthWorkout {
  /** A persistent source ID. Do not generate a new UUID every time a sync runs. */
  id: string;
  date: string;
  name: string;
  durationMin: number;
  distanceM?: number | null;
  /** Active workout energy, not total daily energy and not dietary calories. */
  energyKcal?: number | null;
}

export interface ShortcutHealthPayload {
  source: "apple-shortcuts";
  days?: ShortcutHealthDay[];
  workouts?: ShortcutHealthWorkout[];
}

export interface HealthConnectionStatus {
  lastSyncAt: string | null;
  itemCount: number;
  tokenConfigured: boolean;
  /** What the last Shortcut sync sent: fields with data today and fields wired up but empty. */
  fields?: { at: string; filled?: string[]; empty?: string[]; error?: string; sent?: string; warnings?: string[] } | null;
}

export interface HealthTokenResponse {
  token: string;
  endpoint: string;
}

export interface HealthImportReceipt {
  imported?: number;
  itemCount?: number;
  count?: number;
  warnings?: string[];
  source?: string;
}

export const HEALTH_FIELD_LABELS: Record<HealthDayField, string> = {
  steps: "步数", sleepH: "睡眠", weightKg: "体重", activeEnergyKcal: "活动能量",
  restingHeartRate: "静息心率", hrvMs: "心率变异性", exerciseMin: "运动分钟数", waistCm: "腰围", wristTempC: "手腕温度", basalEnergyKcal: "静息能量",
};
