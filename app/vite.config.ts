import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({plugins:[react()],base:'./',server:{host:'127.0.0.1',port:5188,strictPort:true,proxy:{'/api':'http://127.0.0.1:8787'}},preview:{host:'127.0.0.1',port:5189},build:{target:'es2022'},test:{environment:'node'}} as Parameters<typeof defineConfig>[0])
