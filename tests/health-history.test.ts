import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { readHealthExport } from "../src/health-history";

const record = (type: string, unit: string, value: number, start: string, children = "") =>
  `<Record type="HKQuantityTypeIdentifier${type}" sourceName="iPhone" unit="${unit}" creationDate="${start}" startDate="${start}" endDate="${start}" value="${value}"${children ? `>\n${children}\n</Record>` : "/>"}\n`;
// Padding pushes records across stream chunk boundaries.
const padding = `<Record type="HKQuantityTypeIdentifierStepCount" sourceName="Watch" unit="count" startDate="2026-10-05 08:00:00 +1300" value="40"/>\n`.repeat(3000);
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE HealthData [\n<!ATTLIST Record type CDATA #REQUIRED>\n]>\n<HealthData locale="zh_CN">\n`
  + record("BodyMass", "kg", 74.2, "2026-10-01 07:10:00 +1300")
  + padding
  + record("BodyMass", "kg", 73.9, "2026-10-01 21:30:00 +1300", `<MetadataEntry key="HKWasUserEntered" value="1"/>`)
  + record("BodyMass", "lb", 160, "2026-10-03 07:00:00 +1300")
  + padding
  + record("WaistCircumference", "in", 32.5, "2026-10-03 07:05:00 +1300")
  + record("WaistCircumference", "cm", 0, "2026-10-04 07:05:00 +1300")
  + record("BodyMass", "kg", 73.1, "2026-10-05 07:00:00 +1300")
  + record("EstimatedWorkoutEffortScore", "appleEffortScore", 5, "2026-10-05 18:00:00 +1300")
  + record("WorkoutEffortScore", "appleEffortScore", 7, "2026-10-05 18:00:00 +1300")
  + `<Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" duration="52.5" durationUnit="min" sourceName="Watch" startDate="2026-10-05 18:00:00 +1300" endDate="2026-10-05 18:52:30 +1300">
  <MetadataEntry key="HKTimeZone" value="Pacific/Auckland"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" startDate="2026-10-05 18:00:00 +1300" endDate="2026-10-05 18:52:30 +1300" sum="310.4" unit="kcal"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" startDate="2026-10-05 18:00:00 +1300" endDate="2026-10-05 18:52:30 +1300" average="128.4" minimum="80" maximum="165" unit="count/min"/>
 </Workout>
`
  + padding
  + `<Workout workoutActivityType="HKWorkoutActivityTypeWalking" duration="20" durationUnit="min" sourceName="Watch" startDate="2026-10-06 07:00:00 +1300" endDate="2026-10-06 07:20:00 +1300">
  <MetadataEntry key="HKIndoorWorkout" value="1"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" startDate="2026-10-06 07:00:00 +1300" endDate="2026-10-06 07:20:00 +1300" sum="1.52" unit="km"/>
 </Workout>
`
  + `</HealthData>\n`;

function zip(entries: { name: string; data: string }[]): Blob {
  const parts: Uint8Array[] = [], directory: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name), raw = new TextEncoder().encode(entry.data), packed = deflateRawSync(raw);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 8, true);
    local.setUint32(18, packed.length, true); local.setUint32(22, raw.length, true); local.setUint16(26, name.length, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true); central.setUint16(8, 0x0800, true); central.setUint16(10, 8, true);
    central.setUint32(20, packed.length, true); central.setUint32(24, raw.length, true); central.setUint16(28, name.length, true); central.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), name, packed);
    directory.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + packed.length;
  }
  const dirSize = directory.reduce((n, part) => n + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, dirSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, new Uint8Array(end.buffer)] as BlobPart[]);
}

const expected = {
  days: [
    { date: "2026-10-01", weightKg: 73.9 },
    { date: "2026-10-03", weightKg: 72.57, waistCm: 82.6 },
    { date: "2026-10-05", weightKg: 73.1 },
  ],
  workouts: [
    { id: "TraditionalStrengthTraining|2026-10-05 18:00:00 +1300", date: "2026-10-05", name: "传统力量训练", durationMin: 52.5, startedAt: "2026-10-05T05:00:00.000Z", endedAt: "2026-10-05T05:52:30.000Z", energyKcal: 310, avgHr: 128, maxHr: 165, effort: 7 },
    { id: "Walking|2026-10-06 07:00:00 +1300", date: "2026-10-06", name: "室内步行", durationMin: 20, startedAt: "2026-10-05T18:00:00.000Z", endedAt: "2026-10-05T18:20:00.000Z", distanceM: 1520 },
  ],
};

test("health export zip: picks the main xml, keeps the latest reading per day, converts units and reads workouts", async () => {
  const file = zip([{ name: "apple_health_export/导出_cda.xml", data: record("BodyMass", "kg", 99, "2026-10-02 07:00:00 +1300") }, { name: "apple_health_export/导出.xml", data: xml }]);
  let progress = 0;
  assert.deepEqual(await readHealthExport(file, done => { progress = done; }), expected);
  assert.ok(progress > 0);
});

test("health export xml picked directly gives the same days", async () => {
  assert.deepEqual(await readHealthExport(new Blob([xml])), expected);
});

test("a zip without the export xml explains what to pick", async () => {
  await assert.rejects(readHealthExport(zip([{ name: "photo.txt", data: "x" }])), /没有找到健康数据/);
});
