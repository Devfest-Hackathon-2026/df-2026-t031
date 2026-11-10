import {describe,it,expect} from 'vitest'
import {execFileSync} from 'node:child_process'
import {readdirSync} from 'node:fs'

/** 本番（Cloud Run）は node が .ts の型を消すだけで動かすので、vitest では通る書き方（引数プロパティ・enum など）でも起動に失敗する。ここで node 自体に読ませて確かめる */
describe('node の型除去だけで読める',()=>{
 for(const f of readdirSync('server').filter(f=>f.endsWith('.ts')&&f!=='index.ts'))it(f,()=>{expect(()=>execFileSync(process.execPath,['-e',`import('./server/${f}')`],{stdio:'pipe'})).not.toThrow()})
 it('index.ts（構文だけ）',()=>{expect(()=>execFileSync(process.execPath,['--check','server/index.ts'],{stdio:'pipe'})).not.toThrow()})
})
