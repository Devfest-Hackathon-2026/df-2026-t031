// Android のデバッグ APK を作る（JDK 21 と Android SDK 36 が必要）。2026-11-10 作成
//   npm run apk → android/app/build/outputs/apk/debug/app-debug.apk
import {execFileSync} from 'node:child_process'
import {existsSync} from 'node:fs'
const run=(cmd,args,opts={})=>execFileSync(cmd,args,{stdio:'inherit',shell:process.platform==='win32',...opts})
run('npm',['run','build'])
run('npx',['cap',existsSync('android')?'sync':'add','android'])
run(process.platform==='win32'?'gradlew.bat':'./gradlew',['assembleDebug'],{cwd:'android'})
console.log('APK: android/app/build/outputs/apk/debug/app-debug.apk')
