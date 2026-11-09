import {Coffee,X} from 'lucide-react'
import {SNOOZE_MINUTES} from '../domain/restNeed.ts'

/** RC-5 アプリ内バナー。プッシュ通知は使わない。表示条件は shouldSuggestRest で決める */
export function RestBanner({walkingMinutes,hot,onRest,onSnooze,onDisable}:{walkingMinutes:number;hot:boolean;onRest:()=>void;onSnooze:()=>void;onDisable:()=>void}){
 return <div className="rest-banner" role="status"><Coffee size={18}/><p><b>約{walkingMinutes}分歩いています</b><span>{hot?'暑さ指数が高めです。':''}近くでひと休みしませんか？</span></p>
  <div className="rest-banner-actions"><button className="primary" onClick={onRest}>休憩する</button><button onClick={onSnooze}>今はいい（{SNOOZE_MINUTES}分）</button><button className="link-button" onClick={onDisable}>提案を出さない</button></div>
  <button className="icon-button" aria-label={`閉じる（${SNOOZE_MINUTES}分後にまた確認）`} onClick={onSnooze}><X size={16}/></button></div>
}
