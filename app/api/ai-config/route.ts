import {z} from 'zod';
import {owner,json,failure,AppError} from '@/lib/server-store';
import {getAiConfig,saveAiConfig,deleteAiConfig} from '@/lib/ai-config';
import {env} from '@/lib/runtime-env';
const input=z.object({apiKey:z.string().trim().min(16).max(300),model:z.enum(['deepseek-flash','deepseek-v4-pro']).default('deepseek-flash')}).strict();
export async function GET(request:Request){try{const user=await owner(request),config=await getAiConfig(user);return json({connected:!!config,model:config?.model??'deepseek-flash',environmentManaged:!!env.DEEPSEEK_API_KEY});}catch(e){return failure(e);}}
export async function POST(request:Request){try{const user=await owner(request);if(env.DEEPSEEK_API_KEY)throw new AppError('当前由部署环境管理 API key，请先移除环境配置。',409);const value=input.parse(await request.json());await saveAiConfig(user,value.apiKey,value.model);return json({connected:true,model:value.model,message:'DeepSeek 配置已加密保存。可以测试连接。'});}catch(e){return failure(e);}}
export async function DELETE(request:Request){try{const user=await owner(request);if(env.DEEPSEEK_API_KEY)throw new AppError('当前由部署环境管理连接，请在部署设置中移除。',409);await deleteAiConfig(user);return json({connected:false,message:'DeepSeek 连接已移除。'});}catch(e){return failure(e);}}
