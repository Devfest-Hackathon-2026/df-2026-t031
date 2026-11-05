const r=await fetch('http://127.0.0.1:8787/api/health');if(!r.ok)throw Error(`API server: ${r.status}`);const data=await r.json();console.log({server:'ready',geminiConfigured:data.gemini,weatherConfigured:data.weather});console.log('設定の有無だけを確認しました。実APIの成功を示すものではありません。')
export {}
