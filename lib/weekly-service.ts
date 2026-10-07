import {buildWeeklySummary} from './weekly-summary';
import {loadData,db} from './server-store';
import {type AppData} from './domain';
export async function ensureWeeklyReport(user='local-owner',supplied?:AppData){
 const data=supplied??await loadData(user),report=buildWeeklySummary(data),end=report.period.end;
 const existing=await db().prepare('SELECT payload FROM weekly_reports WHERE owner=? AND week_end=?').bind(user,end).first<{payload:string}>();
 // Refresh deterministic statistics when late logs are added; this uses no paid API.
 const payload=JSON.stringify(report);if(!existing||existing.payload!==payload)await db().prepare('INSERT INTO weekly_reports (owner,week_end,payload,generated_at) VALUES (?,?,?,?) ON CONFLICT(owner,week_end) DO UPDATE SET payload=excluded.payload,generated_at=excluded.generated_at').bind(user,end,payload,new Date().toISOString()).run();
 return report;
}
export async function scheduledWeekly(){const profiles=await db().prepare('SELECT owner FROM profiles').all<{owner:string}>();for(const profile of profiles.results)await ensureWeeklyReport(profile.owner);
 // Receipts only guard against retried requests; old ones are dead weight in the free 5 GB.
 await db().prepare('DELETE FROM operations WHERE created_at<?').bind(new Date(Date.now()-60*86400000).toISOString()).run();}
