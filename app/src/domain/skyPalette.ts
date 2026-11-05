/**
 * 太陽の高度に合わせた空と光の色（Sunlitt のように、時刻を動かすと街の色が変わる）。
 * 昼はピンクがかった明るい空、黄金時間は橙寄り、日没直後は紫がかった青い時間、夜は濃紺。
 * キーフレームの間は線形に補間するので、時刻スライダーを動かしても色がなめらかにつながる。
 */
export interface SkyPalette{
 /** 3Dの背景・霧の色 */sky:string
 /** 太陽光の色と強さ */sun:string;sunIntensity:number
 /** 空からの環境光（上・下）と強さ */hemiSky:string;hemiGround:string;hemiIntensity:number
 /** 露出 */exposure:number
 /** 2D地図に重ねる色と濃さ（乗算） */tint:string;tintOpacity:number
}
type Key=[altitude:number,palette:SkyPalette]
const KEYS:Key[]=[
 [-12,{sky:'#121a2c',sun:'#7d8fc0',sunIntensity:0,hemiSky:'#4a5b88',hemiGround:'#1a2030',hemiIntensity:.8,exposure:1.05,tint:'#1b2645',tintOpacity:.62}],
 [-6,{sky:'#2b3a63',sun:'#8a8fd0',sunIntensity:0,hemiSky:'#6f7fb8',hemiGround:'#2c3248',hemiIntensity:1,exposure:1.1,tint:'#2c3b6b',tintOpacity:.5}],
 [-3,{sky:'#6d5f8f',sun:'#e48a7a',sunIntensity:0,hemiSky:'#a294c4',hemiGround:'#4c4658',hemiIntensity:1.2,exposure:1.15,tint:'#5e4f86',tintOpacity:.36}],
 [0,{sky:'#eea47e',sun:'#ff8a3d',sunIntensity:1.2,hemiSky:'#f4bfa0',hemiGround:'#7d6458',hemiIntensity:1.35,exposure:1.18,tint:'#e9925f',tintOpacity:.24}],
 [6,{sky:'#f4cdb4',sun:'#ffbe7a',sunIntensity:2.2,hemiSky:'#f7dccb',hemiGround:'#9b8a7f',hemiIntensity:1.7,exposure:1.2,tint:'#f2b47c',tintOpacity:.12}],
 [15,{sky:'#efe6e2',sun:'#fff3df',sunIntensity:2.7,hemiSky:'#f6f5f3',hemiGround:'#a5a29b',hemiIntensity:1.9,exposure:1.22,tint:'#ffffff',tintOpacity:0}],
]
const hex=(c:string)=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16))
const mixColor=(a:string,b:string,t:number)=>'#'+hex(a).map((v,i)=>Math.round(v+(hex(b)[i]-v)*t).toString(16).padStart(2,'0')).join('')
const mix=(a:number,b:number,t:number)=>a+(b-a)*t
export function skyPalette(altitude:number):SkyPalette{
 if(altitude<=KEYS[0][0])return KEYS[0][1]
 const i=KEYS.findIndex(([alt])=>alt>=altitude);if(i<0)return KEYS[KEYS.length-1][1]
 const [a0,p]=KEYS[i-1],[a1,q]=KEYS[i],t=(altitude-a0)/(a1-a0)
 return {sky:mixColor(p.sky,q.sky,t),sun:mixColor(p.sun,q.sun,t),sunIntensity:mix(p.sunIntensity,q.sunIntensity,t),hemiSky:mixColor(p.hemiSky,q.hemiSky,t),hemiGround:mixColor(p.hemiGround,q.hemiGround,t),hemiIntensity:mix(p.hemiIntensity,q.hemiIntensity,t),exposure:mix(p.exposure,q.exposure,t),tint:mixColor(p.tint,q.tint,t),tintOpacity:mix(p.tintOpacity,q.tintOpacity,t)}
}
