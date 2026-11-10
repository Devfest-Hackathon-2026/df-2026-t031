import type {IncomingMessage,ServerResponse} from 'node:http'
import {handleRequest} from './index.ts'

// Vercel Functions の入り口。scripts/vercel-output.mjs がこのファイルを 1 本の JS に束ね、
// .vercel/output/functions/api/index.func に置く（Build Output API）。
// /api/* はすべてこの関数へ回し、元のパスは __path で受け取る。処理は Node サーバーと同じ handleRequest。
// api/ ディレクトリを使わないのは、@vercel/node が TypeScript 7（JS API なし）でコンパイルできないため。

export default async function handler(req:IncomingMessage,res:ServerResponse){
 const url=new URL(req.url??'/','http://localhost')
 const path=url.searchParams.get('__path')
 if(path!==null){
  url.searchParams.delete('__path')
  const query=url.searchParams.toString()
  req.url=`/api/${path.replace(/^\/+/,'')}${query?`?${query}`:''}`
 }
 // Workload Identity 連携（Gemini を Vertex AI で呼ぶとき）に使う OIDC トークン
 const oidc=req.headers['x-vercel-oidc-token']
 if(typeof oidc==='string'&&oidc)process.env.VERCEL_OIDC_TOKEN=oidc
 await handleRequest(req,res)
}
