// 2026-11-10 期間内に書き直し。
// 設定画面の「地図キー」「データと共有」と、端末データ削除の確認。App から状態と操作を受け取って描くだけ。
import { Layers, RefreshCw } from 'lucide-react'
import type { AreaDataset } from '../domain/types.ts'
import type { MapMode } from './MapView.tsx'
import Modal from './Modal.tsx'

const asOfLabel = (asOf: string | null | undefined) =>
  asOf ? new Date(asOf).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '不明'

interface MapKeyProps {
  mapKey: string
  busy: boolean
  onMapKey: (key: string) => void
  /** Google 地図に切り替えるときは設定画面も閉じる */
  onConnect: (mode: MapMode) => void
  onModelMap: () => void
}

export function MapKeySection({ mapKey, busy, onMapKey, onConnect, onModelMap }: MapKeyProps) {
  const cannotConnect = !mapKey.trim() || busy
  return (
    <section className="setting-section">
      <h3>
        <Layers size={17} />
        Google 2D / 写実的3D地図
      </h3>
      <label>
        Google Maps用ブラウザーキー
        <input
          autoComplete="off"
          type="password"
          aria-label="Google Maps APIキー"
          placeholder="APIキーを入力"
          value={mapKey}
          onChange={(event) => onMapKey(event.target.value)}
        />
      </label>
      <p className="field-note">
        入力したキーは画面のメモリー内だけで扱います。リファラー・API制限を設定してください。3Dの見た目とOSMによる日陰計算は別です。
      </p>
      <div className="button-row">
        <button disabled={cannotConnect} onClick={() => onConnect('google2d')}>Google 2Dに接続</button>
        <button disabled={cannotConnect} onClick={() => onConnect('google3d')}>Google 3Dに接続</button>
        <button onClick={onModelMap}>モデル地図に戻す</button>
      </div>
    </section>
  )
}

interface DataProps {
  dataset: AreaDataset
  busy: boolean
  sharing: boolean
  onFetchLive: () => void
  onBundled: () => void
  onToggleSharing: () => void
}

export function DataSection({ dataset, busy, sharing, onFetchLive, onBundled, onToggleSharing }: DataProps) {
  const { spots, buildings, trees, meta } = dataset
  return (
    <section className="setting-section">
      <h3>
        <RefreshCw size={17} />
        データと共有
      </h3>
      <p className="field-note">
        {spots.length}地点 / 建物{buildings.length}件 / 樹木{trees.length}本。基準: {asOfLabel(meta.asOf)}
      </p>
      <div className="button-row">
        <button disabled={busy} onClick={onFetchLive}>OSMをライブ取得</button>
        <button onClick={onBundled}>同梱データに戻す</button>
      </div>
      <button className="wide-button" disabled={busy} onClick={onToggleSharing}>
        {sharing ? 'Firebase共有を停止' : 'Firebaseで新しい投稿を共有'}
      </button>
      <p className="field-note">共有には環境変数の設定と、Firebaseの匿名認証・Firestoreルールの適用が必要です。</p>
    </section>
  )
}

interface DeleteProps {
  onBack: () => void
  onDelete: () => void
}

export function DeleteDataModal({ onBack, onDelete }: DeleteProps) {
  return (
    <Modal title="端末内のデータを削除" onClose={onBack}>
      <div className="modal-body">
        <p>
          登録した地点、端末内の投稿、保存先を削除します。必要なら先にJSONで保存してください。共有済みのFirestore投稿は削除されません。
        </p>
        <div className="button-row">
          <button onClick={onBack}>戻る</button>
          <button className="danger-button" onClick={onDelete}>削除する</button>
        </div>
      </div>
    </Modal>
  )
}
