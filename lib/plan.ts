export type Exercise = {
  id: string;
  name: string;
  aliases: string[];
  day: number;
  block: 'warm-up' | 'main' | 'core' | 'finisher';
  sets: number | null;
  repsMin: number | null;
  repsMax: number | null;
  prescription: string;
  rest: string;
  tip: string;
  howTo: string[];
  isKeyLift: boolean;
  unit: string;
  increment: string;
  startingWeight?: number | string;
  ramp?: string[];
  underReview?: boolean;
};

export type Session = {
  day: number; // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  name: string;
  focus: string;
  warmup: string[];
  exercises: Exercise[];
  notes: string[];
  customSwim?: boolean;
};


// Free logging starts with no prescribed sessions or personal measurements.
export const SEED_PLAN: Session[] = Array.from({length:7},(_,day)=>({day,name:'自由训练',focus:'练完后直接汇报',warmup:[],exercises:[],notes:[]}));
export const SWIM_STAGES: {month:number;focus:string;exercises:Exercise[]}[] = [];
export const SWIM_MOBILITY: Exercise[] = [];
export const ROADMAP: never[] = [];
export const EFFORT_GUIDANCE={mainLifts:'',isolation:'',feel:{Easy:'轻松',OK:'适中',Hard:'吃力'},progression:'',plateau:'',pace:'',pain:'有疼痛记录时暂停加重建议。',deload:''};
