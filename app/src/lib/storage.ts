// 2026-11-10 期間内に書き直し。
// この端末の localStorage に置くデータ（保存した地点・投稿・自分で登録した地点・通報・答え合わせ）。
// 読み込み・復元のたびに形を確かめ、知らない項目は捨ててから使う。

import type { SeatFeatureSnapshot, SeatReport, ShadeCheck, Spot, SpotFlag } from '../domain/types.ts'
import { inBounds } from '../domain/area.ts'

export interface SavedData {
  version: 1
  favorites: string[]
  reports: SeatReport[]
  spots: Spot[]
  flags: SpotFlag[]
  checks: ShadeCheck[]
}

export const EMPTY: SavedData = { version: 1, favorites: [], reports: [], spots: [], flags: [], checks: [] }

const STORAGE_KEY = 'epoku:v1'
const MAX_ID = 150
const LIMIT = { spots: 1000, reports: 10000, favorites: 2000, flags: 5000, checks: 5000 }

const SPOT_KINDS = new Set(['bench', 'shelter', 'picnic', 'toilet', 'trash', 'water', 'indoor'])
const TRI = new Set(['yes', 'no', 'unknown'])
const REPORT_VALUES = new Set(['sat', 'full', 'missing', 'facility'])
const FLAG_REASONS = new Set(['missing', 'moved', 'wrong-items', 'spam'])
const SHADE_SUN = new Set(['shade', 'sun'])
const DAY_TYPES = new Set(['weekday', 'weekend', 'holiday'])
const SHADE_STATES = new Set(['sun', 'building', 'tree', 'roof', 'night', 'cloud'])
const CONDITIONS = new Set(['clear', 'partly-cloudy', 'cloudy', 'fog', 'rain', 'heavy-rain', 'snow', 'unknown'])

/* ── 小さな判定 ─────────────────────────────── */

const isId = (v: unknown) => typeof v === 'string' && v.length <= MAX_ID
const isDate = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v))
const inRange = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && lo <= v && v <= hi
const inRangeOrNull = (v: unknown, lo: number, hi: number) => v === null || inRange(v, lo, hi)
const isTri = (v: unknown): v is 'yes' | 'no' | 'unknown' => typeof v === 'string' && TRI.has(v)
/** 省略可の文字列。あれば長さの上限を見る */
const optionalText = (v: unknown, max: number) => v === undefined || (typeof v === 'string' && v.length <= max)

/** 後から足した項目は古いバックアップにないので、無ければ空の配列として扱う */
function listOrEmpty(v: unknown, max: number, message: string): any[] {
  const list = v === undefined ? [] : v
  if (!Array.isArray(list) || list.length > max) throw new Error(message)
  return list
}

/* ── 投稿時の予測の入力 ─────────────────────── */

/** 投稿に添えた予測の入力。形が崩れていれば undefined を返し、投稿そのものは残す */
export function validFeatures(f: any): SeatFeatureSnapshot | undefined {
  if (!f || typeof f !== 'object') return undefined
  const ok =
    inRange(f.hour, 0, 24) &&
    DAY_TYPES.has(f.dayType) &&
    inRangeOrNull(f.temperatureC, -50, 60) &&
    inRangeOrNull(f.wbgt, -20, 50) &&
    (f.condition === null || CONDITIONS.has(f.condition)) &&
    SHADE_STATES.has(f.shade) &&
    typeof f.roof === 'boolean' &&
    inRangeOrNull(f.aiProbability, 0, 1)
  if (!ok) return undefined
  const { hour, dayType, temperatureC, wbgt, condition, shade, roof, aiProbability } = f
  return { hour, dayType, temperatureC, wbgt, condition, shade, roof, aiProbability }
}

/* ── 1 件ずつの検査と整形 ───────────────────── */

function cleanReport(r: any): SeatReport {
  const valid =
    r && isId(r.id) && isId(r.spotId) && REPORT_VALUES.has(r.value) &&
    isDate(r.reportedAt) && Date.parse(r.reportedAt) <= Date.now() + 60_000 &&
    r.origin === 'local'
  if (!valid) throw new Error('投稿データの形式が不正です。')
  const features = validFeatures(r.features)
  return { id: r.id, spotId: r.spotId, value: r.value, reportedAt: r.reportedAt, origin: 'local', ...(features ? { features } : {}) }
}

function cleanSpot(s: any): Spot {
  const p = s?.position
  const valid =
    s && isId(s.id) &&
    typeof s.name === 'string' && s.name.trim() !== '' && s.name.length <= 80 &&
    SPOT_KINDS.has(s.kind) &&
    p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && inBounds(p) &&
    isTri(s.roof) && s.origin === 'user' &&
    (s.seats === null || (Number.isInteger(s.seats) && s.seats >= 1 && s.seats <= 100)) &&
    optionalText(s.note, 160) && optionalText(s.description, 300) &&
    (s.createdAt === undefined || isDate(s.createdAt))
  if (!valid) throw new Error('地点データの形式が不正です。')

  const spot: Spot = {
    id: s.id,
    name: s.name,
    kind: s.kind,
    position: { lat: p.lat, lng: p.lng },
    origin: 'user',
    roof: s.roof,
    roofSource: 'user',
    seats: s.seats,
    backrest: 'unknown',
    wheelchair: 'unknown',
    infoSource: 'user',
  }
  // RC-0 の設備情報は、はい・いいえ・わからない のどれかのときだけ持ち込む
  if (isTri(s.cooling)) spot.cooling = s.cooling
  if (isTri(s.stepFree)) spot.stepFree = s.stepFree
  if (isTri(s.accessibleToilet)) spot.accessibleToilet = s.accessibleToilet
  if (isDate(s.verifiedAt)) spot.verifiedAt = s.verifiedAt
  if (s.note) spot.note = s.note
  if (s.description) spot.description = s.description
  if (s.createdAt) spot.createdAt = s.createdAt
  return spot
}

function cleanFlag(f: any): SpotFlag {
  if (!f || !isId(f.id) || !isId(f.spotId) || !FLAG_REASONS.has(f.reason) || !isDate(f.flaggedAt)) {
    throw new Error('通報データの形式が不正です。')
  }
  return { id: f.id, spotId: f.spotId, reason: f.reason, flaggedAt: f.flaggedAt }
}

function cleanCheck(c: any): ShadeCheck {
  if (!c || !isId(c.id) || !isId(c.spotId) || !SHADE_SUN.has(c.observed) || !SHADE_SUN.has(c.predicted) || !isDate(c.checkedAt)) {
    throw new Error('答え合わせデータの形式が不正です。')
  }
  return { id: c.id, spotId: c.spotId, observed: c.observed, predicted: c.predicted, checkedAt: c.checkedAt }
}

/* ── 全体 ───────────────────────────────────── */

/** 保存データ・バックアップを検査し、必要な項目だけを持つ新しいオブジェクトにして返す */
export function validateSaved(input: unknown): SavedData {
  if (!input || typeof input !== 'object') throw new Error('Rest Care（epoku）のバックアップではありません。')
  const d = input as Record<string, any>

  const sizesOk =
    d.version === 1 &&
    Array.isArray(d.favorites) && d.favorites.length <= LIMIT.favorites &&
    Array.isArray(d.reports) && d.reports.length <= LIMIT.reports &&
    Array.isArray(d.spots) && d.spots.length <= LIMIT.spots
  if (!sizesOk) throw new Error('バックアップの形式・件数を確認してください。')
  if (!d.favorites.every(isId)) throw new Error('保存先の形式が不正です。')

  const reports = d.reports.map(cleanReport)
  const spots = d.spots.map(cleanSpot)
  const flags = listOrEmpty(d.flags, LIMIT.flags, '通報データの形式・件数を確認してください。').map(cleanFlag)
  const checks = listOrEmpty(d.checks, LIMIT.checks, '答え合わせデータの形式・件数を確認してください。').map(cleanCheck)

  return { version: 1, favorites: Array.from(new Set<string>(d.favorites)), reports, spots, flags, checks }
}

export function readSaved(): { data: SavedData; error?: string } {
  try {
    const text = localStorage.getItem(STORAGE_KEY)
    return { data: text ? validateSaved(JSON.parse(text)) : structuredClone(EMPTY) }
  } catch {
    return { data: structuredClone(EMPTY), error: '保存データを読み取れませんでした。初期状態で表示しています。' }
  }
}

export function persist(data: SavedData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(validateSaved(data)))
  } catch {
    throw new Error('保存できませんでした。ブラウザーの保存設定や空き容量をご確認ください。')
  }
}

/** バックアップを JSON ファイルとしてダウンロードさせる */
export function exportSaved(data: SavedData): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = 'epoku-backup.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}
