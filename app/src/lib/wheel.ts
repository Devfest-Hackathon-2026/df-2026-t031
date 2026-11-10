/**
 * ホイールの操作を「地図を動かす」か「拡大・縮小」かに分ける。
 * - ピンチ（トラックパッドで二本指をつまむ）はブラウザーが ctrlKey 付きで送るので拡大・縮小
 * - トラックパッドの二本指スライドは移動（Windows ではこれがホイールとして届くため、以前は拡大・縮小になっていた）
 * - マウスのホイールは拡大・縮小（1 目盛りで 100 前後の大きな値、または行単位で届く）
 * 二本指スライドの惰性で値が大きくなっても移動のまま続けるため、直前がトラックパッドなら 300ms はトラックパッドとみなす。
 */
export interface WheelLike{deltaX:number;deltaY:number;deltaMode:number;ctrlKey:boolean;timeStamp:number}
export type WheelAction='pan'|'zoom'
export const PAD_MAX_DELTA=50,PAD_STICKY_MS=300
export function makeWheelClassifier(){
 let lastPad=-Infinity
 return (e:WheelLike):WheelAction=>{
  if(e.ctrlKey)return 'zoom'
  if(e.deltaMode!==0)return 'zoom'
  const pad=e.deltaX!==0||Math.abs(e.deltaY)<PAD_MAX_DELTA||e.timeStamp-lastPad<PAD_STICKY_MS
  if(pad){lastPad=e.timeStamp;return 'pan'}
  return 'zoom'
 }
}
