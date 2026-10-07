import {owner,loadData,json,failure,db,dataVersion} from "@/lib/server-store";
import {todayNZ} from "@/lib/domain";
export const dynamic="force-dynamic";
// ?v=<version>&today=<date>: when nothing changed (and it is still the same day) answer with one row read instead of every record.
export async function GET(request:Request){try{
 const user=await owner(request);const url=new URL(request.url);const v=url.searchParams.get("v");
 if(v&&url.searchParams.get("today")===todayNZ()){
  const row=await db().prepare("SELECT data_version,plan_version,settings FROM profiles WHERE owner=?").bind(user).first<{data_version:number;plan_version:number;settings:string}>();
  if(row&&dataVersion(row)===v)return json({unchanged:true});
 }
 return json(await loadData(user));
}catch(e){return failure(e);}}
