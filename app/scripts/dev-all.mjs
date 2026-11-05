import {spawn} from 'node:child_process'
const api=spawn(process.execPath,['--watch','server/index.ts'],{stdio:'inherit'}),web=spawn(process.execPath,['node_modules/vite/bin/vite.js'],{stdio:'inherit'})
const stop=()=>{api.kill();web.kill()};process.on('SIGINT',stop);process.on('SIGTERM',stop);api.on('exit',()=>web.kill());web.on('exit',()=>api.kill())
