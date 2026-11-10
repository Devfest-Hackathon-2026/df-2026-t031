// 2026-11-10 期間内に書き直し。
// 3D の街（建物・窓・公園・木・道路・水面）を Three.js のメッシュに組み立てる。
// 同じ色のものは 1 つのメッシュにまとめて描画回数を減らす。

import * as T from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { LocalProjection } from '../domain/geo.ts'
import { AREA_CENTER, EXPLORER_FOCUS } from '../domain/area.ts'
import type { AreaDataset, Building, LatLng } from '../domain/types.ts'
import { FERRIS_WHEEL_NAME } from '../domain/landmarks.ts'

/** 緯度経度 → 平面（m）。3D では x が東、-z が北 */
export const cityProjection = new LocalProjection(AREA_CENTER)

/** 道路・水面（OSM から取った周辺の線と面） */
export interface ContextFeature {
  id: number
  kind: 'road' | 'water'
  roadType?: string
  name?: string
  points: [number, number][]
}
export interface CityContext { features: ContextFeature[] }

export function worldPoint(p: LatLng, height = 0): T.Vector3 {
  const { x, y } = cityProjection.toXY(p)
  return new T.Vector3(x, height, -y)
}

/* ── 共通の部品 ─────────────────────────────── */

/** 外形の緯度経度から、押し出し・面に使う 2D の形を作る */
function outlineShape(ring: LatLng[]): T.Shape {
  const shape = new T.Shape()
  const [first, ...rest] = ring.map((p) => cityProjection.toXY(p))
  shape.moveTo(first.x, first.y)
  for (const q of rest) shape.lineTo(q.x, q.y)
  shape.closePath()
  return shape
}

/** 外形を上に押し出した立体。y=0 から depth まで（後から持ち上げる） */
function prism(ring: LatLng[], depth: number): T.BufferGeometry {
  const geometry = new T.ExtrudeGeometry(outlineShape(ring), { depth, bevelEnabled: false, steps: 1, curveSegments: 1 })
  geometry.rotateX(-Math.PI / 2)
  geometry.deleteAttribute('uv')
  return geometry
}

/** 地面に貼る平らな面（公園・水面） */
function flatPatch(ring: LatLng[], lift: number): T.BufferGeometry {
  const geometry = new T.ShapeGeometry(outlineShape(ring))
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, lift, 0)
  geometry.deleteAttribute('uv')
  return geometry
}

interface Finish { roughness?: number; metalness?: number }

/** 形をまとめて 1 つのメッシュにし、root に足す。元の形は捨てる */
function addBatch(root: T.Group, parts: T.BufferGeometry[], color: string, castShadow = false, finish: Finish = {}) {
  if (parts.length === 0) return
  const merged = mergeGeometries(parts, false)
  for (const part of parts) part.dispose()
  if (!merged) return
  const material = new T.MeshStandardMaterial({ color, roughness: finish.roughness ?? 0.92, metalness: finish.metalness ?? 0 })
  const mesh = new T.Mesh(merged, material)
  mesh.castShadow = castShadow
  mesh.receiveShadow = true
  root.add(mesh)
}

/* ── 建物 ───────────────────────────────────── */

const WALL_COLORS = ['#ebe4da', '#e4ddd2', '#efe9e1', '#e1d9ce', '#e8e1d7']
const GLASS = '#a3b7c6'
const GLASS_FINISH: Finish = { roughness: 0.3, metalness: 0.28 }
/** これより高い建物はガラス張りとして塗る（m） */
const TALL_M = 90
/** 窓を描くのは注目地点のこの距離（緯度経度の二乗）以内だけ */
const WINDOW_RADIUS2 = 0.00009
const WINDOW_HARD_CAP = 300_000

/** 注目地点からの近さ（緯度方向を少し伸ばした二乗距離） */
function focusDistance2(p: LatLng): number {
  return ((p.lat - EXPLORER_FOCUS.lat) * 1.23) ** 2 + (p.lng - EXPLORER_FOCUS.lng) ** 2
}

/** PLATEAU の .glb を読めないときに出す、外形から作った箱 */
function plateauFallback(buildings: Building[]): T.Group {
  const group = new T.Group()
  group.name = 'plateau-fallback'
  const low: T.BufferGeometry[] = []
  const tall: T.BufferGeometry[] = []
  for (const b of buildings) {
    if (b.heightSource !== 'plateau' || b.footprint.length < 3) continue
    ;(b.height >= TALL_M ? tall : low).push(prism(b.footprint, b.height))
  }
  addBatch(group, low, '#d9d5ca', true)
  addBatch(group, tall, GLASS, true, GLASS_FINISH)
  return group
}

/**
 * 壁 1 面ぶんの窓を三角形で足す。窓は幅 1.5m・高さ 2.5m、横 5m・縦 5.2m おき。
 * 壁から外へ 0.12m 浮かせて、壁と重なってちらつかないようにする
 */
function addWallWindows(out: number[], a: { x: number; y: number }, c: { x: number; y: number }, outward: number, b: Building) {
  const length = Math.hypot(c.x - a.x, c.y - a.y)
  if (length < 8) return
  const ux = (c.x - a.x) / length
  const uy = (c.y - a.y) / length
  const offX = uy * outward * 0.12
  const offY = -ux * outward * 0.12
  for (let y = Math.max(b.minHeight + 3, 3); y < b.height - 2; y += 5.2) {
    for (let d = 3; d < length - 2; d += 5) {
      if (out.length > WINDOW_HARD_CAP) break
      const x0 = a.x + ux * d + offX
      const z0 = -(a.y + uy * d + offY)
      const x1 = x0 + ux * 1.5
      const z1 = z0 - uy * 1.5
      const top = y + 2.5
      out.push(x0, y, z0, x1, y, z1, x1, top, z1, x0, y, z0, x1, top, z1, x0, top, z0)
    }
  }
}

/* ── 木 ─────────────────────────────────────── */

const LEAF_COLORS = ['#7fc070', '#92cd7f', '#6db363', '#9fd68d']

/** 幹 1 本と葉の塊 3 つで 1 本の木。どちらもインスタンスで描く */
function createTrees(dataset: AreaDataset, lightQuality: boolean): T.Object3D[] {
  const trees = lightQuality ? dataset.trees.filter((_, i) => i % 2 === 0) : dataset.trees
  const trunks = new T.InstancedMesh(
    new T.CylinderGeometry(0.35, 0.55, 1, 5),
    new T.MeshStandardMaterial({ color: '#8f7f68', roughness: 1 }),
    trees.length,
  )
  const crowns = new T.InstancedMesh(
    new T.IcosahedronGeometry(1, lightQuality ? 0 : 1),
    new T.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 1 }),
    trees.length * 3,
  )
  for (const mesh of [trunks, crowns]) {
    mesh.castShadow = true
    mesh.receiveShadow = true
  }

  const place = new T.Object3D()
  trees.forEach((tree, i) => {
    const base = worldPoint(tree.position)
    const height = Math.min(24, tree.height)
    const radius = Math.min(7, Math.max(2.2, tree.crownRadius))

    place.position.set(base.x, height * 0.3, base.z)
    place.scale.set(1, height * 0.6, 1)
    place.rotation.set(0, 0, 0)
    place.updateMatrix()
    trunks.setMatrixAt(i, place.matrix)

    for (let j = 0; j < 3; j++) {
      // 黄金角ずつずらして、木ごとに葉の付き方を変える
      const angle = i * 2.39 + j * 2.1
      const spread = j === 0 ? 1 : 0.78
      place.position.set(base.x + Math.cos(angle) * radius * 0.4, height * 0.7 + (j === 0 ? radius * 0.3 : 0), base.z + Math.sin(angle) * radius * 0.4)
      place.scale.set(radius * spread, radius * 0.85, radius * spread)
      place.rotation.set(i * 0.17, j * 0.7, i * 0.06)
      place.updateMatrix()
      crowns.setMatrixAt(i * 3 + j, place.matrix)
      crowns.setColorAt(i * 3 + j, new T.Color(LEAF_COLORS[(i + j) % LEAF_COLORS.length]))
    }
  })
  trunks.computeBoundingSphere()
  crowns.computeBoundingSphere()
  return [trunks, crowns]
}

/* ── 街全体 ─────────────────────────────────── */

/** 建物・窓・公園・木をまとめた Group を返す。lightQuality では窓と木を減らす */
export function createCity(dataset: AreaDataset, lightQuality = false): T.Group {
  const root = new T.Group()

  const ground = new T.Mesh(new T.PlaneGeometry(7000, 7000), new T.MeshStandardMaterial({ color: '#eeedea', roughness: 1 }))
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.3
  ground.receiveShadow = true
  root.add(ground)

  root.add(plateauFallback(dataset.buildings))

  // 色ごとの置き場。赤レンガ倉庫・日本丸・高層ビルは見てすぐ分かる素材にする
  const walls: T.BufferGeometry[][] = WALL_COLORS.map(() => [])
  const glass: T.BufferGeometry[] = []
  const brick: T.BufferGeometry[] = []
  const white: T.BufferGeometry[] = []
  const roofLines: number[] = []
  const windows: number[] = []
  const windowBudget = lightQuality ? 65_000 : 180_000

  // 注目地点に近い順に並べ、窓の予算を近くの建物から使う
  const osmBuildings = dataset.buildings
    .filter((b) => b.heightSource !== 'plateau')
    .map((b) => ({ b, d: focusDistance2(b.footprint[0] ?? AREA_CENTER) }))
    .sort((p, q) => p.d - q.d)
    .map((p) => p.b)

  osmBuildings.forEach((b, order) => {
    if (b.footprint.length < 3) return
    if (b.name === FERRIS_WHEEL_NAME) {
      root.add(createFerrisWheel(b.footprint))
      return
    }

    const body = prism(b.footprint, Math.max(0.5, b.height - b.minHeight))
    body.translate(0, b.minHeight, 0)
    if (b.name?.includes('赤レンガ倉庫')) brick.push(body)
    else if (b.name === '日本丸') white.push(body)
    else if (b.height >= TALL_M) glass.push(body)
    else walls[order % WALL_COLORS.length].push(body)

    // 屋上の縁取りと、外形の向き（符号付き面積）
    const ring = b.footprint.map((p) => cityProjection.toXY(p))
    const edgeY = b.height + 0.08
    let signedArea = 0
    ring.forEach((a, i) => {
      const c = ring[(i + 1) % ring.length]
      signedArea += a.x * c.y - c.x * a.y
      roofLines.push(a.x, edgeY, -a.y, c.x, edgeY, -c.y)
    })

    const wantsWindows =
      b.height >= 10 && ring.length <= 45 && windows.length <= windowBudget && focusDistance2(b.footprint[0]) <= WINDOW_RADIUS2
    if (!wantsWindows) return
    const outward = signedArea >= 0 ? 1 : -1
    ring.forEach((a, i) => addWallWindows(windows, a, ring[(i + 1) % ring.length], outward, b))
  })

  WALL_COLORS.forEach((color, i) => addBatch(root, walls[i], color, true))
  addBatch(root, glass, GLASS, true, GLASS_FINISH)
  addBatch(root, brick, '#a9563c', true, { roughness: 0.96 })
  addBatch(root, white, '#f4f2ec', true, { roughness: 0.6 })

  const outline = new T.BufferGeometry()
  outline.setAttribute('position', new T.Float32BufferAttribute(roofLines, 3))
  root.add(new T.LineSegments(outline, new T.LineBasicMaterial({ color: '#fbf8f3', transparent: true, opacity: 0.7 })))

  const panes = new T.BufferGeometry()
  panes.setAttribute('position', new T.Float32BufferAttribute(windows, 3))
  panes.computeVertexNormals()
  const windowMesh = new T.Mesh(panes, new T.MeshStandardMaterial({ color: '#a9bfd3', roughness: 0.45, side: T.DoubleSide }))
  windowMesh.name = 'city-window-detail'
  root.add(windowMesh)

  const parks = dataset.parks.filter((p) => p.ring.length >= 3).map((p) => flatPatch(p.ring, 0.02))
  addBatch(root, parks, '#bde8ad')

  root.add(...createTrees(dataset, lightQuality))
  return root
}

/* ── 道路と水面 ─────────────────────────────── */

/** 道路の種類ごとの幅（m）。表にないものは 4m */
const ROAD_WIDTH_M: Record<string, number> = {
  motorway: 20, trunk: 18, primary: 16, secondary: 13, tertiary: 10,
  residential: 7, unclassified: 7, service: 5, pedestrian: 8,
  cycleway: 3, footway: 2.6, path: 2.2, steps: 2.5, track: 3.5,
}
const roadWidthOf = (type: string) => ROAD_WIDTH_M[type] ?? 4

/** 描かない道路（計画中・工事中・ホーム・エレベーター） */
const SKIPPED_ROADS = new Set(['proposed', 'construction', 'platform', 'elevator'])
/** 歩行者向けの細い道。歩道を付けずに白く描く */
const WALKWAYS = new Set(['footway', 'path', 'cycleway', 'pedestrian', 'steps'])

/** 折れ線を幅 width の帯（三角形の並び）にして高さ height に置く */
export function strip(points: [number, number][], width: number, height: number): T.BufferGeometry {
  const xy = points.map(([lat, lng]) => cityProjection.toXY({ lat, lng }))
  const half = width / 2
  const vertices: number[] = []
  for (let i = 1; i < xy.length; i++) {
    const a = xy[i - 1]
    const b = xy[i]
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length < 0.1) continue
    // 進む向きに直角な横ずれ
    const sx = (-(b.y - a.y) / length) * half
    const sy = ((b.x - a.x) / length) * half
    const leftA = [a.x + sx, height, -a.y - sy]
    const rightA = [a.x - sx, height, -a.y + sy]
    const rightB = [b.x - sx, height, -b.y + sy]
    const leftB = [b.x + sx, height, -b.y - sy]
    vertices.push(...leftA, ...rightA, ...rightB, ...leftA, ...rightB, ...leftB)
  }
  const geometry = new T.BufferGeometry()
  geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3))
  geometry.computeVertexNormals()
  return geometry
}

/** 道路・歩道・小道・水面の Group を返す */
export function createContext(context: CityContext): T.Group {
  const root = new T.Group()
  const water: T.BufferGeometry[] = []
  const roads: T.BufferGeometry[] = []
  const sidewalks: T.BufferGeometry[] = []
  const walkways: T.BufferGeometry[] = []

  for (const feature of context.features) {
    if (feature.points.length < 2) continue
    if (feature.kind === 'water') {
      if (feature.points.length >= 4) water.push(flatPatch(feature.points.map(([lat, lng]) => ({ lat, lng })), 0.03))
      continue
    }
    const type = feature.roadType || 'service'
    if (SKIPPED_ROADS.has(type)) continue
    const width = roadWidthOf(type)
    if (WALKWAYS.has(type)) {
      walkways.push(strip(feature.points, width, 0.15))
    } else {
      sidewalks.push(strip(feature.points, width + 4, 0.07))
      roads.push(strip(feature.points, width, 0.12))
    }
  }

  addBatch(root, water, '#a3d0f2')
  addBatch(root, sidewalks, '#f5f4f1')
  addBatch(root, roads, '#c3ccd8')
  addBatch(root, walkways, '#ffffff')
  return root
}

/** Object3D の下にある形と素材をすべて解放する */
export function disposeObject(object: T.Object3D): void {
  const geometries = new Set<T.BufferGeometry>()
  const materials = new Set<T.Material>()
  object.traverse((child) => {
    const { geometry, material } = child as T.Mesh
    if (geometry) geometries.add(geometry)
    if (material) for (const m of [material].flat()) materials.add(m)
    if (child instanceof T.InstancedMesh) child.dispose()
  })
  for (const g of geometries) g.dispose()
  for (const m of materials) m.dispose()
}

/** 2点を結ぶ円柱（観覧車の支柱など） */
function beam(a:T.Vector3,b:T.Vector3,r:number,material:T.Material){const len=a.distanceTo(b),m=new T.Mesh(new T.CylinderGeometry(r,r,len,8),material);m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),b.clone().sub(a).normalize());m.castShadow=true;return m}
/**
 * コスモクロック21（高さ約112m・直径約100m）を観覧車の形で作る。外形の向き（いちばん長い方向）に輪をそろえる。
 * 輪・ゴンドラ・中心の時計は夜に光る（CityMap が userData.lights の強さを変える）
 */
export function createFerrisWheel(footprint:LatLng[]){
 const ring=footprint.map(p=>cityProjection.toXY(p)),cx=ring.reduce((n,p)=>n+p.x,0)/ring.length,cy=ring.reduce((n,p)=>n+p.y,0)/ring.length
 let sxx=0,syy=0,sxy=0;for(const p of ring){const dx=p.x-cx,dy=p.y-cy;sxx+=dx*dx;syy+=dy*dy;sxy+=dx*dy}
 const axis=.5*Math.atan2(2*sxy,sxx-syy),group=new T.Group();group.name='ferris-wheel';group.position.set(cx,0,-cy);group.rotation.y=axis
 const R=50,H=62.5,lights:T.MeshStandardMaterial[]=[]
 const steel=new T.MeshStandardMaterial({color:'#eef1f4',roughness:.35,metalness:.45,emissive:'#7fd6ff',emissiveIntensity:0});lights.push(steel)
 const leg=new T.MeshStandardMaterial({color:'#d9dde2',roughness:.5,metalness:.35})
 for(const [r,t] of [[R,1],[R-7,.55]] as const){const torus=new T.Mesh(new T.TorusGeometry(r,t,8,120),steel);torus.position.y=H;torus.castShadow=true;group.add(torus)}
 const spokes:number[]=[];for(let i=0;i<36;i++){const a=i/36*Math.PI*2;for(const z of [-1.6,1.6])spokes.push(0,H,z,Math.cos(a)*R,H+Math.sin(a)*R,z)}
 const sg=new T.BufferGeometry();sg.setAttribute('position',new T.Float32BufferAttribute(spokes,3));group.add(new T.LineSegments(sg,new T.LineBasicMaterial({color:'#c9ced4'})))
 const colors=['#f2a7bb','#8fd0e8','#f5d76e','#a8dc95','#c3aef0'],gondolas=new T.InstancedMesh(new T.BoxGeometry(2.8,3.2,2.8),new T.MeshStandardMaterial({color:'#ffffff',roughness:.5,emissive:'#ffffff',emissiveIntensity:0}),60),d=new T.Object3D()
 lights.push(gondolas.material as T.MeshStandardMaterial)
 for(let i=0;i<60;i++){const a=i/60*Math.PI*2;d.position.set(Math.cos(a)*(R+2.6),H+Math.sin(a)*(R+2.6)-1.6,0);d.updateMatrix();gondolas.setMatrixAt(i,d.matrix);gondolas.setColorAt(i,new T.Color(colors[i%colors.length]))}
 gondolas.castShadow=true;group.add(gondolas)
 const hub=new T.Mesh(new T.CylinderGeometry(4.5,4.5,7,20),leg);hub.rotation.x=Math.PI/2;hub.position.y=H;group.add(hub)
 const clockMat=new T.MeshStandardMaterial({color:'#2d3640',roughness:.4,emissive:'#ffe9a8',emissiveIntensity:0});lights.push(clockMat)
 for(const z of [3.6,-3.6]){const face=new T.Mesh(new T.CircleGeometry(10,32),clockMat);face.position.set(0,H,z);if(z<0)face.rotation.y=Math.PI;group.add(face)}
 const top=new T.Vector3(0,H,0);for(const x of [-16,16])for(const z of [-9,9])group.add(beam(new T.Vector3(x,0,z),top,1.1,leg))
 const base=new T.Mesh(new T.BoxGeometry(44,9,18),new T.MeshStandardMaterial({color:'#e7e2d9',roughness:.85}));base.position.y=4.5;base.castShadow=true;base.receiveShadow=true;group.add(base)
 group.userData.lights=lights;return group
}
/** PLATEAU の建物（1つの立体）に高さで色を付ける: 低い所は石のベージュ、30m より上ほどガラスの青灰に */
export function tintByHeight(mesh:T.Mesh){
 const g=mesh.geometry,pos=g.getAttribute('position');if(!pos)return
 mesh.updateWorldMatrix(true,false);const v=new T.Vector3(),stone=new T.Color('#e6dfd4'),glass=new T.Color('#a8bccb'),c=new T.Color(),out=new Float32Array(pos.count*3)
 for(let i=0;i<pos.count;i++){v.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);const t=Math.min(1,Math.max(0,(v.y-30)/55));c.copy(stone).lerp(glass,t);out[i*3]=c.r;out[i*3+1]=c.g;out[i*3+2]=c.b}
 g.setAttribute('color',new T.BufferAttribute(out,3));const m=mesh.material as T.MeshStandardMaterial;m.vertexColors=true;m.color.set('#ffffff');m.roughness=.62;m.metalness=.12;m.needsUpdate=true
}
