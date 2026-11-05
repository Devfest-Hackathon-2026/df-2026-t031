import {spawnSync} from 'node:child_process'
import {existsSync} from 'node:fs'
const node=process.execPath
function run(command,args,options={}){const r=spawnSync(command,args,{stdio:'inherit',...options});if(r.error){console.error(r.error.message);process.exit(1)}if(r.status!==0)process.exit(r.status||1)}
run(node,['node_modules/typescript/bin/tsc','-b'])
run(node,['node_modules/vite/bin/vite.js','build'])
run(node,['scripts/generate-sw.mjs'])
if(!existsSync('android'))run(node,['node_modules/@capacitor/cli/bin/capacitor','add','android'])
run(node,['node_modules/@capacitor/cli/bin/capacitor','sync','android'])
const windows=process.platform==='win32';run(windows?'cmd.exe':'./gradlew',windows?['/d','/s','/c','gradlew.bat assembleDebug']:['assembleDebug'],{cwd:'android'})
console.log('APK: android/app/build/outputs/apk/debug/app-debug.apk')
