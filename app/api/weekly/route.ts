import {owner,json,failure} from '@/lib/server-store';
import {ensureWeeklyReport} from '@/lib/weekly-service';
export async function GET(request:Request){try{return json({report:await ensureWeeklyReport(await owner(request))});}catch(e){return failure(e);}}
