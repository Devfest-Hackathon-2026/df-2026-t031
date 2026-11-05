import type {SeatReport} from '../domain/types.ts'
export interface ReportConnection{post:(r:SeatReport)=>Promise<void>;remove:(id:string)=>Promise<void>;close:()=>void}
export async function enableSharedReports(onReports:(r:SeatReport[])=>void,onError:(s:string)=>void):Promise<ReportConnection>{
 const raw=import.meta.env.VITE_FIREBASE_CONFIG
 if(!raw)throw Error('Firebaseは未接続です。VITE_FIREBASE_CONFIGを設定してください。')
 let config:Record<string,string>;try{config=JSON.parse(raw)}catch{throw Error('Firebase設定のJSONを確認してください。')}
 if(!config?.apiKey||!config.projectId||!config.appId)throw Error('Firebase設定にはapiKey・projectId・appIdが必要です。')
 const [appSdk,authSdk,dbSdk]=await Promise.all([import('firebase/app'),import('firebase/auth'),import('firebase/firestore')])
 const app=appSdk.getApps().find(a=>a.name==='epoku')??appSdk.initializeApp(config,'epoku'),auth=authSdk.getAuth(app)
 const user=auth.currentUser??(await authSdk.signInAnonymously(auth)).user,db=dbSdk.getFirestore(app)
 const collection=dbSdk.collection(db,'epokuReports'),query=dbSdk.query(collection,dbSdk.orderBy('createdAt','desc'),dbSdk.limit(250))
 let stop:()=>void=()=>{}
 await new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>{stop();reject(Error('Firebase接続がタイムアウトしました。設定をご確認ください。'))},20000)
  let ready=false
  stop=dbSdk.onSnapshot(query,snapshot=>{const rows:SeatReport[]=snapshot.docs.flatMap(doc=>{const d=doc.data();if(typeof d.id!=='string'||typeof d.spotId!=='string'||!['sat','full','missing'].includes(d.value)||typeof d.createdAt?.toDate!=='function')return [];return [{id:d.id,spotId:d.spotId,value:d.value,reportedAt:d.createdAt.toDate().toISOString(),origin:'shared' as const}]});onReports(rows);if(!ready){ready=true;clearTimeout(timer);resolve()}},()=>{clearTimeout(timer);if(!ready){stop();reject(Error('Firestoreを読めません。匿名認証とセキュリティルールをご確認ください。'))}else onError('共有データの更新が停止しました。設定から共有を再接続してください。')})
 })
 return {async post(r){await dbSdk.setDoc(dbSdk.doc(db,'epokuReports',`${user.uid}_${r.id}`),{id:r.id,spotId:r.spotId,value:r.value,ownerUid:user.uid,createdAt:dbSdk.serverTimestamp()})},async remove(id){await dbSdk.deleteDoc(dbSdk.doc(db,'epokuReports',`${user.uid}_${id}`))},close:stop}
}
