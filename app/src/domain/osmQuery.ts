// Overpass API の問い合わせ文。scripts/fetch-osm.ts（同梱データの作成）で使う。2026-11-10 作成
import {AREA_BOUNDS} from './area.ts'
export type Bounds={south:number;west:number;north:number;east:number}
const bbox=(b:Bounds)=>`${b.south},${b.west},${b.north},${b.east}`
/** 休憩スポット・建物・樹木・公園・人が集まる場所 */
export function areaQuery(b:Bounds=AREA_BOUNDS){const x=bbox(b);return `[out:json][timeout:120];(
node["amenity"~"^(bench|shelter|toilets|waste_basket|recycling|waste_disposal|drinking_water|water_point|library|community_centre|lounge)$"](${x});
way["amenity"~"^(shelter|toilets|library|community_centre)$"](${x});
node["leisure"="picnic_table"](${x});
way["building"](${x});way["building:part"](${x});
node["natural"="tree"](${x});way["natural"="tree_row"](${x});
way["leisure"~"^(park|garden|playground)$"](${x});way["landuse"~"^(grass|recreation_ground|village_green)$"](${x});
node["railway"="station"](${x});node["public_transport"="station"](${x});
nwr["shop"~"^(mall|department_store)$"](${x});nwr["tourism"~"^(attraction|museum|viewpoint|gallery|theme_park)$"](${x});
);out geom qt;`}
/** 徒歩経路・3D の道路と水面 */
export function contextQuery(b:Bounds=AREA_BOUNDS){const x=bbox(b);return `[out:json][timeout:120];(
way["highway"](${x});way["natural"="water"](${x});way["waterway"~"^(canal|river|dock)$"](${x});way["landuse"="basin"](${x});way["natural"="coastline"](${x});
);out geom qt;`}
