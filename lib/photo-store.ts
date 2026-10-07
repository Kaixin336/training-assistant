import { env } from './runtime-env';
const MAX_FILE_BYTES = 12 * 1024 * 1024;
export const PHOTO_STORAGE_LIMIT = 450 * 1000 * 1000;
const CHUNK_BYTES = 256 * 1024;
export class PhotoStorageError extends Error { constructor(message: string, readonly status: number) { super(message); } }
function validKey(key: string) { if (!/^photos\/local-owner\/[a-f0-9-]{36}$/.test(key)) throw new PhotoStorageError('无效照片路径。', 400); }
type StoredObject = { body: ReadableStream<Uint8Array>; arrayBuffer(): Promise<ArrayBuffer> };
export class D1PhotoStore {
  async put(key: string, bytes: Uint8Array, options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }) {
    validKey(key);
    if (!bytes.byteLength || bytes.byteLength > MAX_FILE_BYTES) throw new PhotoStorageError('照片应小于 12 MB。', 413);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer));
    const checksum = [...digest].map(b => b.toString(16).padStart(2, '0')).join('');
    const existing = await env.DB.prepare('SELECT checksum FROM photo_objects WHERE key=?').bind(key).first<{ checksum: string }>();
    if (existing) { if (existing.checksum !== checksum) throw new PhotoStorageError('同一次上传的照片发生变化，请重新选择照片后重试。', 409); return; }
    const statements = [env.DB.prepare('INSERT OR IGNORE INTO photo_objects (key,size,checksum,content_type,created_at) SELECT ?,?,?,?,? WHERE COALESCE((SELECT SUM(size) FROM photo_objects),0)+?<=?').bind(key, bytes.byteLength, checksum, options?.httpMetadata?.contentType || 'application/octet-stream', new Date().toISOString(), bytes.byteLength, PHOTO_STORAGE_LIMIT)];
    // Four rows per statement keeps a maximum-size image below free-plan query limits.
    for (let start = 0; start < bytes.byteLength; start += CHUNK_BYTES * 4) {
      const selects: string[] = []; const bindings: unknown[] = [];
      for (let offset = start; offset < Math.min(start + CHUNK_BYTES * 4, bytes.byteLength); offset += CHUNK_BYTES) {
        selects.push('SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM photo_objects WHERE key=? AND checksum=?)');
        bindings.push(key, offset / CHUNK_BYTES, bytes.slice(offset, offset + CHUNK_BYTES).buffer, key, checksum);
      }
      statements.push(env.DB.prepare(`INSERT OR IGNORE INTO photo_chunks (key,part,bytes) ${selects.join(' UNION ALL ')}`).bind(...bindings));
    }
    await env.DB.batch(statements);
    const saved = await env.DB.prepare('SELECT checksum FROM photo_objects WHERE key=?').bind(key).first<{ checksum: string }>();
    if (!saved) throw new PhotoStorageError('照片空间已接近免费容量上限，请先导出备份或配置独立照片存储。', 507);
    if (saved.checksum !== checksum) throw new PhotoStorageError('同一次上传的照片发生变化，请重新上传。', 409);
  }
  async get(key: string): Promise<StoredObject | null> {
    validKey(key);
    const object = await env.DB.prepare('SELECT size FROM photo_objects WHERE key=?').bind(key).first<{ size: number }>();
    if (!object) return null;
    // D1 serializes blobs as number arrays. Load four chunks at a time to avoid
    // expanding a 12 MB image into a >96 MB JavaScript array inside the Worker.
    function stream() {
      let nextPart=0,received=0;
      return new ReadableStream<Uint8Array>({async pull(controller){
        const result=await env.DB.prepare('SELECT part,bytes FROM photo_chunks WHERE key=? AND part>=? ORDER BY part LIMIT 4').bind(key,nextPart).all<{part:number;bytes:ArrayBuffer|number[]}>();
        if(!result.results.length){if(received!==object!.size)throw new PhotoStorageError('照片文件不完整，请从备份恢复。',503);controller.close();return;}
        for(const row of result.results){if(row.part!==nextPart++)throw new PhotoStorageError('照片文件不完整，请从备份恢复。',503);const chunk=new Uint8Array(row.bytes);received+=chunk.byteLength;if(received>object!.size)throw new PhotoStorageError('照片文件不完整，请从备份恢复。',503);controller.enqueue(chunk);}
        if(received===object!.size)controller.close();
      }});
    }
    return {get body(){return stream();},async arrayBuffer(){const joined=new Uint8Array(object.size);const reader=stream().getReader();let offset=0;while(true){const{value,done}=await reader.read();if(done)break;joined.set(value,offset);offset+=value.byteLength;}return joined.buffer;}};
  }
  async delete(key: string) { validKey(key); await env.DB.batch([env.DB.prepare('DELETE FROM photo_chunks WHERE key=?').bind(key), env.DB.prepare('DELETE FROM photo_objects WHERE key=?').bind(key)]); }
}
const d1 = new D1PhotoStore();
export function photoStore() {
  return {
    async put(key: string, bytes: Uint8Array, options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }) { validKey(key); return env.BUCKET ? env.BUCKET.put(key, bytes, options) : d1.put(key, bytes, options); },
    async get(key: string) { validKey(key); return (env.BUCKET ? await env.BUCKET.get(key) : null) || d1.get(key); },
    async delete(key: string) { validKey(key); if (env.BUCKET) await env.BUCKET.delete(key); await d1.delete(key); },
  };
}
