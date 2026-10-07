import {owner,loadData,failure,db} from "@/lib/server-store";
import {isPlanned} from "@/lib/diet";
import {backupOwner} from "@/app/api/backup/token/route";
export const dynamic="force-dynamic";
export const BACKUP_FORMAT="kai-training-v1";
function csv(value:unknown){const s=typeof value==="string"?value:JSON.stringify(value);const safe=/^[=+\-@\t\r]/.test(s)?`'${s}`:s;return `"${safe.replaceAll('"','""')}"`;}
// Original photos are fetched one by one by the browser and added to the backup file:
// streaming them here would exceed the D1 free-plan limit of 50 queries per request.
export async function GET(request:Request){try{
 // ?key= is the read-only link used by the weekly iCloud backup Shortcut.
 const key=new URL(request.url).searchParams.get("key");
 const user=key!==null?await backupOwner(key):await owner(request);const data=await loadData(user);
 // Plan meals are implied, not stored; a restore must not turn them into real records.
 data.items=data.items.filter(i=>!isPlanned(i));
 const messages=await db().prepare("SELECT payload FROM messages WHERE owner=? ORDER BY created_at,id").bind(user).all<{payload:string}>();data.messages=messages.results.map(r=>JSON.parse(r.payload));
 const url=new URL(request.url);
 if(url.searchParams.get("format")==="csv"){
  const rows=["record_type,id,date,data_json",["settings","settings","",data.settings].map(csv).join(","),...[...data.items.map(i=>({type:i.kind,id:i.id,date:i.date,value:i})),...data.messages.map(m=>({type:"message",id:m.id,date:m.createdAt,value:m}))].map(r=>[r.type,r.id,r.date,r.value].map(csv).join(","))];
  return new Response("﻿"+rows.join("\r\n"),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="kai-training-${data.today}.csv"`,"Cache-Control":"private, no-store"}});
 }
 const {aiEnabled:_,activeSession:__,plan:___,planVersion:____,changes:_____,...rest}=data;
 const exported={format:BACKUP_FORMAT,exportedAt:new Date().toISOString(),timezone:"Pacific/Auckland",photoFiles:[] as unknown[],...rest};
 return new Response(JSON.stringify(exported),{headers:{"Content-Type":"application/json; charset=utf-8","Content-Disposition":`attachment; filename="kai-training-${data.today}.json"`,"Cache-Control":"private, no-store"}});
}catch(e){return failure(e);}}
