// Generates data/continents.json from Natural Earth country shapes. Only needs
// re-running if the map geometry changes; the site itself uses the output.
import { readFileSync, writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';

const topo = JSON.parse(readFileSync('node_modules/world-atlas/countries-50m.json', 'utf8'));
const countries = JSON.parse(readFileSync('node_modules/world-countries/countries.json', 'utf8'));

const URALS_LON = 60;
const MIN_ISLAND_AREA = 0.05; // square degrees; smaller specks vanish at map scale

// Shapes the country table has no entry for, keyed by Natural Earth name.
const BY_NAME = {
  Kosovo: 'europe',
  Somaliland: 'africa',
  'N. Cyprus': 'asia',
  'Siachen Glacier': 'asia',
  'Indian Ocean Ter.': 'oceania',
  'Ashmore and Cartier Is.': 'oceania',
};

const byCode = new Map(countries.map((c) => [c.ccn3, c]));

function continentOf(f) {
  if (BY_NAME[f.properties.name]) return BY_NAME[f.properties.name];
  const c = byCode.get(f.id);
  if (!c) throw new Error(`No continent for ${f.properties.name} (${f.id})`);
  if (c.region === 'Antarctic') return null;
  if (c.region === 'Americas') return c.subregion === 'South America' ? 'south-america' : 'north-america';
  return c.region.toLowerCase();
}

// Shapes crossing the antimeridian jump from +180 to -180; shift the far side
// past 180 so the outline stays continuous on a flat map.
function unwrap(ring) {
  const crosses = ring.some((p, i) => i && Math.abs(p[0] - ring[i - 1][0]) > 180);
  return crosses ? ring.map(([x, y]) => [x < 0 ? x + 360 : x, y]) : ring;
}

function centroid(ring) {
  const sum = ring.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
  return [sum[0] / ring.length, sum[1] / ring.length];
}

// European countries' overseas territories belong on the map where they are.
function overseas(name, [lon, lat], fallback) {
  if (!['France', 'Netherlands', 'Spain', 'Portugal'].includes(name)) return fallback;
  if (lon < -50 && lat < 10) return 'south-america';
  if (lon < -50) return 'north-america';
  if (name === 'Spain' && lat < 35) return 'africa';
  if (lon > 40) return 'africa';
  return fallback;
}

// Sutherland-Hodgman against a meridian; keeps the side where lon < URALS_LON
// when west is true.
function clipRing(ring, west) {
  const inside = ([x]) => (west ? x < URALS_LON : x >= URALS_LON);
  const out = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    if (inside(a)) out.push(a);
    if (inside(a) !== inside(b)) {
      const t = (URALS_LON - a[0]) / (b[0] - a[0]);
      out.push([URALS_LON, a[1] + t * (b[1] - a[1])]);
    }
  }
  if (out.length) out.push(out[0]);
  return out;
}

function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(sum) / 2;
}

function simplifyRing(ring) {
  const out = [];
  for (const [x, y] of ring) {
    const p = [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out.length >= 4 ? out : null;
}

const result = { asia: [], europe: [], africa: [], 'north-america': [], 'south-america': [], oceania: [] };

function add(continent, rings) {
  if (!rings.length) return; // nothing left after clipping
  const outer = simplifyRing(rings[0]);
  if (!outer || ringArea(outer) < MIN_ISLAND_AREA) return;
  result[continent].push([outer, ...rings.slice(1).map(simplifyRing).filter(Boolean)]);
}

for (const f of feature(topo, topo.objects.countries).features) {
  const name = f.properties.name;
  const base = continentOf(f);
  if (!base || !f.geometry) continue;
  const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const raw of polygons) {
    const rings = raw.map(unwrap);
    if (name === 'Russia') {
      if (centroid(rings[0])[0] < 0) {
        add('asia', rings); // islands wholly past the antimeridian
        continue;
      }
      add('europe', rings.map((r) => clipRing(r, true)).filter((r) => r.length));
      add('asia', rings.map((r) => clipRing(r, false)).filter((r) => r.length));
      continue;
    }
    add(overseas(name, centroid(rings[0]), base), rings);
  }
}

writeFileSync('data/continents.json', JSON.stringify(result));
for (const [k, v] of Object.entries(result)) console.log(k, v.length, 'polygons');
