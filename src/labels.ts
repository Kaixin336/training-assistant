import type { LogItem, Photo, Settings } from "@/lib/domain";

export const phaseLabels: Record<Settings["phase"], string> = { fat_loss: "减脂期", maintenance: "维持期", lean_gain: "增肌期", unspecified: "未设阶段" };
export const phaseFocus: Record<Settings["phase"], string> = {
  fat_loss: "守住同动作的重量和次数，恢复跟得上。体重下降时力量小幅波动是正常的。",
  maintenance: "稳定训练和恢复，观察同动作表现是否稳定。",
  lean_gain: "同条件下逐步多做一点：先加次数，到范围上限再小幅加重，不必每次都加。",
  unspecified: "选择一个阶段后，进展和周报会按阶段分开比较。",
};
/** Short tag shown next to an exercise name so different load conventions are never confused. */
export const unitTags: Record<string, string> = { "kg/side": "每侧", "kg/hand": "单手", "added kg": "加重", "assisted kg": "辅助", bodyweight: "自重", seconds: "计时", metres: "距离", "bar height notch": "档位" };
export const unitLabels: Record<string, string> = { kg: "公斤", "kg/side": "公斤 · 每侧", "kg/hand": "公斤 · 单手", "added kg": "额外加重", "assisted kg": "辅助重量", bodyweight: "自重", seconds: "秒", metres: "米", "bar height notch": "档位" };
export const unitLabel = (unit: string) => unitLabels[unit] ?? unit;
export const kindLabels: Record<LogItem["kind"], string> = { workout: "训练", metric: "测量", food: "饮食", health: "恢复", skin: "皮肤", note: "备注", photo: "照片" };
export const bodyPhotoKinds = ["body_front", "body_side", "body_back", "body_glute45"] as const satisfies readonly Photo["photoKind"][];
export const photoLabels: Record<Photo["photoKind"], string> = { body_front: "正面", body_side: "侧面", body_back: "背面", body_glute45: "斜后 45°", face_front: "面部", face_left: "面部左", face_right: "面部右" };
export const feelText = { Easy: "轻松", OK: "适中", Hard: "吃力" } as const;
