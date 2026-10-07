import {z} from "zod";
import {settingsSchema,logItemSchema,dateSchema,type ChatMessage,type LogItem,type TrainingSession} from "@/lib/domain";
import {owner,json,failure,commit,db,ensureProfile,receipt,AppError} from "@/lib/server-store";

// D1 Free allows 50 queries per request and 100 bound values per statement.
// Rows are packed ten per statement, so a full batch stays near 25 queries.
export const RESTORE_BATCH = 100;
const messageSchema=z.object({id:z.string().min(1).max(200),role:z.enum(["user","assistant"]),text:z.string().max(20000),createdAt:z.string().max(40),itemIds:z.array(z.string().max(160)).max(100).optional(),proposalId:z.string().max(160).optional(),clarification:z.boolean().optional(),pendingText:z.string().max(20000).optional()}).strict();
const sessionSchema=z.object({id:z.string().min(1).max(160),date:dateSchema,startedAt:z.string().max(40),lastActivityAt:z.string().max(40),endedAt:z.string().max(40).nullable(),activeExerciseId:z.string().max(100).nullable(),activeExerciseName:z.string().max(160).nullable(),activeUnit:z.string().max(60).nullable(),lastWeightKg:z.number().nullable()}).strict();
const input=z.object({operationId:z.string().uuid(),settings:settingsSchema.optional(),items:z.array(z.unknown()).max(RESTORE_BATCH).default([]),messages:z.array(messageSchema).max(RESTORE_BATCH).default([]),sessions:z.array(sessionSchema).max(60).default([])}).strict();
function chunks<T>(rows:T[],size=10){const out:T[][]=[];for(let i=0;i<rows.length;i+=size)out.push(rows.slice(i,i+size));return out;}
export async function POST(request:Request){try{
 const user=await owner(request);const args=input.parse(await request.json());
 const cached=await receipt(user,args.operationId);if(cached)return json(cached);
 const items=args.items.map(raw=>logItemSchema.parse(raw)) as LogItem[];
 if(items.some(item=>item.kind==="photo"))throw new AppError("照片需要连同原图逐张恢复。");
 await ensureProfile(user);const database=db();const now=new Date().toISOString();const statements:D1PreparedStatement[]=[];
 if(args.settings)statements.push(database.prepare("UPDATE profiles SET settings=? WHERE owner=?").bind(JSON.stringify(args.settings),user));
 for(const part of chunks(items))statements.push(database.prepare("INSERT INTO records (owner,id,kind,date,payload,deleted,updated_at) VALUES "+part.map(()=>"(?,?,?,?,?,0,?)").join(",")+" ON CONFLICT(owner,id) DO UPDATE SET kind=excluded.kind,date=excluded.date,payload=excluded.payload,deleted=0,updated_at=excluded.updated_at").bind(...part.flatMap(item=>[user,item.id,item.kind,item.date,JSON.stringify(item),now])));
 for(const part of chunks(args.messages as ChatMessage[]))statements.push(database.prepare("INSERT OR IGNORE INTO messages (owner,id,payload,created_at) VALUES "+part.map(()=>"(?,?,?,?)").join(",")).bind(...part.flatMap(message=>[user,message.id,JSON.stringify(message),message.createdAt])));
 // OR IGNORE also skips a restored open session that would clash with today's open session.
 for(const part of chunks(args.sessions as TrainingSession[],12))statements.push(database.prepare("INSERT OR IGNORE INTO training_sessions (owner,id,date,payload,last_activity_at,ended_at) VALUES "+part.map(()=>"(?,?,?,?,?,?)").join(",")).bind(...part.flatMap(session=>[user,session.id,session.date,JSON.stringify(session),session.lastActivityAt,session.endedAt])));
 return json(await commit(user,args.operationId,statements,{restored:{items:items.length,messages:args.messages.length,sessions:args.sessions.length,settings:!!args.settings}}));
}catch(e){return failure(e);}}
