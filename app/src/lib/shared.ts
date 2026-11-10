// 投稿のチーム共有（Firebase の匿名ログイン＋Firestore）。設定（VITE_FIREBASE_CONFIG）があるときだけ使う。2026-11-10 作成
import type {SeatReport} from '../domain/types.ts'
export interface ShareClient{add(r:SeatReport):Promise<void>;remove(id:string):Promise<void>;stop():void}
/** ビルド時の公開設定（1行のJSON）。無い・壊れているときは null */
export function firebaseConfig():Record<string,string>|null{try{const raw=String(import.meta.env.VITE_FIREBASE_CONFIG||'').trim();if(!raw)return null;const c=JSON.parse(raw);return c&&typeof c.apiKey==='string'&&typeof c.projectId==='string'?c:null}catch{return null}}
/** 共有を始める。直近 250 件を受け取り続け、onReports に渡す */
export async function startSharing(onReports:(r:SeatReport[])=>void,onError:(m:string)=>void):Promise<ShareClient>{
 const config=firebaseConfig();if(!config)throw Error('Firebaseの設定（VITE_FIREBASE_CONFIG）がありません。')
 const [{initializeApp,getApps},{getAuth,signInAnonymously},fs]=await Promise.all([import('firebase/app'),import('firebase/auth'),import('firebase/firestore')])
 const app=getApps()[0]??initializeApp(config),auth=getAuth(app),cred=await signInAnonymously(auth),db=fs.getFirestore(app),col=fs.collection(db,'epokuReports')
 const stop=fs.onSnapshot(fs.query(col,fs.orderBy('createdAt','desc'),fs.limit(250)),snap=>{onReports(snap.docs.flatMap(d=>{const x=d.data();const at=x.createdAt?.toDate?.() as Date|undefined;return typeof x.spotId==='string'&&['sat','full','missing','facility'].includes(x.value)&&at?[{id:d.id,spotId:x.spotId,value:x.value,reportedAt:at.toISOString(),origin:'shared' as const}]:[]}))},e=>onError('共有データを読めませんでした: '+e.message))
 return {
  async add(r){await fs.setDoc(fs.doc(col,r.id),{id:r.id,spotId:r.spotId,value:r.value,ownerUid:cred.user.uid,createdAt:fs.serverTimestamp()})},
  async remove(id){await fs.deleteDoc(fs.doc(col,id))},
  stop
 }
}
