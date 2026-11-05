// Optional developer-run browser smoke checks; this session used Codex's browser controls instead.
import {chromium} from 'playwright-core'
import {spawn} from 'node:child_process'
import assert from 'node:assert/strict'
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5197','--strictPort'],{stdio:'inherit'})
let browser
try{
 let ready=false;for(let i=0;i<40;i++){try{const r=await fetch('http://127.0.0.1:5197/');if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,250))}assert(ready,'Preview server did not start')
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:5197/');await page.locator('.view-nav').getByRole('button',{name:'休憩スポット',exact:true}).click();await page.getByRole('button',{name:'座れた',exact:true}).click();assert.match(await page.locator('.actual-report').innerText(),/座れた/)
 await page.getByRole('button',{name:'この場所を保存',exact:true}).click();await page.reload();await page.locator('.view-nav').getByRole('button',{name:'休憩スポット',exact:true}).click();await page.getByRole('button',{name:'保存を解除',exact:true}).waitFor();assert.match(await page.locator('.actual-report').innerText(),/座れた/)
 await page.getByLabel('スポットを検索',{exact:true}).fill('存在しないスポット');await page.locator('.empty-state').waitFor();await page.getByRole('button',{name:'条件をリセット',exact:true}).click()
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow');assert.deepEqual(errors,[]);console.log('Browser smoke checks passed')
}finally{await browser?.close();server.kill()}
