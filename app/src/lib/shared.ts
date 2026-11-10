import type { SeatReport } from '../domain/types.ts'

// 2026-11-10 期間内に書き直し。
// 空席の投稿を Firestore（epokuReports コレクション）で共有する。匿名ログインで書き込む。

export interface ReportConnection {
  post: (report: SeatReport) => Promise<void>
  remove: (id: string) => Promise<void>
  close: () => void
}

const COLLECTION = 'epokuReports'
const APP_NAME = 'epoku'
const RECENT_LIMIT = 250
const CONNECT_TIMEOUT_MS = 20_000
/** 共有するのは空席の投稿だけ（facility は端末内に残す） */
const SHARED_VALUES: ReadonlySet<string> = new Set(['sat', 'full', 'missing'])

/** VITE_FIREBASE_CONFIG（JSON 文字列）を読み、必須の項目があるか確かめる */
function readFirebaseConfig(): Record<string, string> {
  const json = import.meta.env.VITE_FIREBASE_CONFIG
  if (!json) throw new Error('Firebaseは未接続です。VITE_FIREBASE_CONFIGを設定してください。')
  let config: Record<string, string>
  try {
    config = JSON.parse(json)
  } catch {
    throw new Error('Firebase設定のJSONを確認してください。')
  }
  if (!config?.apiKey || !config.projectId || !config.appId) {
    throw new Error('Firebase設定にはapiKey・projectId・appIdが必要です。')
  }
  return config
}

/** Firestore の 1 文書を SeatReport にする。形が合わなければ null */
function toReport(data: Record<string, unknown>): SeatReport | null {
  const createdAt = data.createdAt as { toDate?: () => Date } | undefined
  if (typeof data.id !== 'string' || typeof data.spotId !== 'string') return null
  if (typeof data.value !== 'string' || !SHARED_VALUES.has(data.value)) return null
  if (typeof createdAt?.toDate !== 'function') return null
  return {
    id: data.id,
    spotId: data.spotId,
    value: data.value as SeatReport['value'],
    reportedAt: createdAt.toDate().toISOString(),
    origin: 'shared',
  }
}

/**
 * 共有を始める。最初のスナップショットが届いた時点で resolve する。
 * 以降の更新は onReports に、途中で止まったときは onError に知らせる。
 */
export async function enableSharedReports(
  onReports: (reports: SeatReport[]) => void,
  onError: (message: string) => void,
): Promise<ReportConnection> {
  const config = readFirebaseConfig()
  const [appSdk, authSdk, fs] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')])

  const app = appSdk.getApps().find((a) => a.name === APP_NAME) ?? appSdk.initializeApp(config, APP_NAME)
  const auth = authSdk.getAuth(app)
  const user = auth.currentUser ?? (await authSdk.signInAnonymously(auth)).user
  const db = fs.getFirestore(app)
  const recent = fs.query(fs.collection(db, COLLECTION), fs.orderBy('createdAt', 'desc'), fs.limit(RECENT_LIMIT))
  // 文書 ID に uid を含めて、ルール側で「自分の投稿だけ消せる」を判定できるようにする
  const docOf = (reportId: string) => fs.doc(db, COLLECTION, `${user.uid}_${reportId}`)

  let unsubscribe: () => void = () => {}
  await new Promise<void>((resolve, reject) => {
    let firstSnapshot = true
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error('Firebase接続がタイムアウトしました。設定をご確認ください。'))
    }, CONNECT_TIMEOUT_MS)

    unsubscribe = fs.onSnapshot(
      recent,
      (snapshot) => {
        onReports(snapshot.docs.map((d) => toReport(d.data())).filter((r): r is SeatReport => r !== null))
        if (firstSnapshot) {
          firstSnapshot = false
          clearTimeout(timeout)
          resolve()
        }
      },
      () => {
        clearTimeout(timeout)
        if (firstSnapshot) {
          unsubscribe()
          reject(new Error('Firestoreを読めません。匿名認証とセキュリティルールをご確認ください。'))
        } else {
          onError('共有データの更新が停止しました。設定から共有を再接続してください。')
        }
      },
    )
  })

  return {
    async post(report) {
      await fs.setDoc(docOf(report.id), {
        id: report.id,
        spotId: report.spotId,
        value: report.value,
        ownerUid: user.uid,
        createdAt: fs.serverTimestamp(),
      })
    },
    async remove(id) {
      await fs.deleteDoc(docOf(id))
    },
    close: () => unsubscribe(),
  }
}
