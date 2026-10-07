import * as data from '../app/api/data/route';
import * as chat from '../app/api/chat/route';
import * as action from '../app/api/action/route';
import * as photos from '../app/api/photos/route';
import * as photo from '../app/api/photos/[id]/route';
import * as exporter from '../app/api/export/route';
import * as aiConfig from '../app/api/ai-config/route';
import * as aiTest from '../app/api/ai-config/test/route';
import * as healthImport from '../app/api/health/import/route';
import * as healthStatus from '../app/api/health/status/route';
import * as healthToken from '../app/api/health/token/route';
import * as backupToken from '../app/api/backup/token/route';
import * as weekly from '../app/api/weekly/route';
import * as weeklyAi from '../app/api/weekly/ai/route';
import * as restore from '../app/api/restore/route';
import * as restorePhoto from '../app/api/restore/photo/route';
import { login, logout, session } from '../lib/auth';
import { failure, json, AppError } from '../lib/server-store';
import { scheduledWeekly } from '../lib/weekly-service';
import type { RuntimeEnv } from '../lib/runtime-env';

type Handler = (request: Request) => Promise<Response>;
const routes: Record<string, Partial<Record<string, Handler>>> = {
  '/api/session': { GET: session }, '/api/login': { POST: login }, '/api/logout': { POST: logout },
  '/api/data': { GET: data.GET }, '/api/chat': { POST: chat.POST }, '/api/action': { POST: action.POST },
  '/api/photos': { POST: photos.POST }, '/api/export': { GET: exporter.GET },
  '/api/ai-config': { GET: aiConfig.GET, POST: aiConfig.POST, DELETE: aiConfig.DELETE }, '/api/ai-config/test': { POST: aiTest.POST },
  '/api/health/import': { GET: healthImport.GET, POST: healthImport.POST }, '/api/health/status': { GET: healthStatus.GET }, '/api/health/token': { POST: healthToken.POST }, '/api/backup/token': { POST: backupToken.POST },
  '/api/weekly': { GET: weekly.GET }, '/api/weekly/ai': { GET: weeklyAi.GET, POST: weeklyAi.POST }, '/api/restore': { POST: restore.POST }, '/api/restore/photo': { POST: restorePhoto.POST },
};
const MB = 1024 * 1024;
const limits: Record<string, number> = { '/api/chat': 13 * MB, '/api/photos': 13 * MB, '/api/restore/photo': 13 * MB, '/api/health/import': 5 * MB + 64 * 1024, '/api/restore': 4 * MB };
async function boundedRequest(request: Request, limit: number) {
  if (['GET', 'HEAD'].includes(request.method)) return request;
  if (Number(request.headers.get('content-length') || 0) > limit) throw new AppError('提交内容过大，请分批上传。', 413);
  const reader = request.body?.getReader();
  if (!reader) return request;
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; length += value.byteLength; if (length > limit) { await reader.cancel(); throw new AppError('提交内容过大，请分批上传。', 413); } chunks.push(value); }
  return new Request(request.url, { method: request.method, headers: request.headers, body: new Blob(chunks as BlobPart[]) });
}
export default {
  async fetch(request: Request, bindings: RuntimeEnv): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/api/')) return bindings.ASSETS.fetch(request);
    try {
      const matched = path.match(/^\/api\/photos\/([^/]+)$/);
      const handlers = routes[path];
      const handler = handlers?.[request.method];
      if (matched && request.method === 'GET') return await photo.GET(request, { params: Promise.resolve({ id: decodeURIComponent(matched[1]) }) });
      if (!handler) return json({ error: handlers || matched ? '此接口不支持该请求方式。' : '接口不存在。' }, handlers || matched ? 405 : 404);
      return await handler(await boundedRequest(request, limits[path] ?? MB));
    } catch (error) { return failure(error); }
  },
  // Deterministic weekly statistics only; no paid AI call happens on the schedule.
  async scheduled(_controller: ScheduledController, _bindings: RuntimeEnv, context: ExecutionContext) {
    context.waitUntil(scheduledWeekly().catch(error => console.error('Weekly report failed', error instanceof Error ? error.name : 'unknown')));
  },
} satisfies ExportedHandler<RuntimeEnv>;
