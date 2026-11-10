// Vercel 用の Build Output API（v3）を .vercel/output に書き出す。npm run build の後に実行する。
//  - static/ … 画面（dist）をそのまま
//  - functions/api/index.func … server/vercel.ts を Vite の SSR ビルドで 1 本の index.mjs に束ねたもの
//  - config.json … /api/* を関数へ、それ以外は静的ファイル→無ければ index.html（1画面アプリ）
// @vercel/node は TypeScript 7 では .ts をコンパイルできないため、関数は自前で束ねる。
import {build} from 'vite'
import {cp,mkdir,rm,writeFile,access} from 'node:fs/promises'

const out='.vercel/output',func=`${out}/functions/api/index.func`
await access('dist/index.html').catch(()=>{throw new Error('dist がありません。先に npm run build を実行してください。')})
await rm(out,{recursive:true,force:true})
await mkdir(func,{recursive:true})
await cp('dist',`${out}/static`,{recursive:true})

await build({
 configFile:false,
 publicDir:false,
 logLevel:'warn',
 build:{
  ssr:'server/vercel.ts',
  outDir:func,
  emptyOutDir:false,
  target:'node22',
  minify:false,
  sourcemap:false,
  rolldownOptions:{output:{format:'esm',entryFileNames:'index.mjs',codeSplitting:false}},
 },
 ssr:{target:'node',noExternal:true},
})

await writeFile(`${func}/.vc-config.json`,JSON.stringify({runtime:'nodejs22.x',handler:'index.mjs',launcherType:'Nodejs',shouldAddHelpers:false,supportsResponseStreaming:true,maxDuration:30},null,1))
await writeFile(`${func}/package.json`,JSON.stringify({type:'module'}))
await writeFile(`${out}/config.json`,JSON.stringify({
 version:3,
 routes:[
  {src:'^/sw\\.js$',headers:{'Cache-Control':'no-cache'},continue:true},
  {src:'^/api(?:/(.*))?$',dest:'/api/index?__path=$1'},
  {handle:'filesystem'},
  {src:'^/(.*)$',dest:'/index.html'},
 ],
},null,1))
console.log('Vercel 用の出力を書き出しました: .vercel/output')
