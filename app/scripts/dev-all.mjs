// 画面（Vite）とローカル API（server/index.ts）を同時に起動する。2026-11-10 作成
import {spawn} from 'node:child_process'
const run=(cmd,args)=>spawn(cmd,args,{stdio:'inherit',shell:process.platform==='win32'})
const api=run(process.execPath,['--env-file-if-exists=.env','--watch','server/index.ts'])
const web=run(process.platform==='win32'?'npx.cmd':'npx',['vite'])
const stop=()=>{api.kill();web.kill();process.exit()}
process.on('SIGINT',stop);process.on('SIGTERM',stop);api.on('exit',c=>{if(c)stop()});web.on('exit',stop)
