import {z} from "zod";
import {photoType} from "@/lib/image-validation";
import {photoSchema} from "@/lib/domain";
import {owner,bucket,json,failure,commit,recordStatement,receipt,AppError} from "@/lib/server-store";

// One original photo per request keeps D1 chunk queries inside the free-plan limit.
export async function POST(request:Request){try{
 const user=await owner(request);const form=await request.formData();
 const operationId=z.string().uuid().parse(form.get("operationId"));const prior=await receipt(user,operationId);if(prior)return json(prior);
 let raw:unknown;try{raw=JSON.parse(String(form.get("record")??""));}catch{throw new AppError("备份中的照片信息无效。");}
 const photo=photoSchema.parse(raw);
 if(!/^[a-f0-9-]{36}$/.test(photo.id)||photo.fileRef!==`photos/${encodeURIComponent(user)}/${photo.id}`)throw new AppError("备份中的照片路径无效。");
 const file=form.get("file");if(!(file instanceof File)||file.size===0||file.size>12*1024*1024)throw new AppError("备份中的照片文件缺失或超过 12 MB。");
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(bytes.byteLength!==photo.size||photoType(bytes)!==photo.contentType)throw new AppError("照片文件与备份记录不一致，未恢复。");
 await bucket().put(photo.fileRef,bytes,{httpMetadata:{contentType:photo.contentType,cacheControl:"private, no-store"}});
 return json(await commit(user,operationId,[recordStatement(user,photo)],{message:"照片已恢复。",id:photo.id}));
}catch(e){return failure(e);}}
