import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
mkdirSync('.runtime',{recursive:true});
// Pure logic: Chinese basic parser, weekly comparisons, Health import normalisation and the Health export reader.
const files=['chat-parser','weekly-summary','health-import','health-history','shortcut-time','insights'];
for(const file of files)await build({entryPoints:[`tests/${file}.test.ts`],bundle:true,platform:'node',format:'esm',outfile:`.runtime/${file}.test.mjs`});
const result=spawnSync(process.execPath,['--test',...files.map(file=>`.runtime/${file}.test.mjs`)],{stdio:'inherit'});
process.exit(result.status??1);
