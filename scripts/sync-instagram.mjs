// Reads the comment count of each continent's Instagram post and writes
// counts.json. Usage: IG_ACCESS_TOKEN=... node scripts/sync-instagram.mjs [outfile]
import { readFileSync, writeFileSync } from 'node:fs';

const GRAPH = process.env.IG_GRAPH_BASE || 'https://graph.instagram.com';
const token = process.env.IG_ACCESS_TOKEN;
const outFile = process.argv[2] || 'data/counts.json';

if (!token) {
  console.error('IG_ACCESS_TOKEN is not set.');
  process.exit(1);
}

const { continents } = JSON.parse(readFileSync('data/challenge.json', 'utf8'));

// /p/ABC123/ and /reel/ABC123/ are the same post.
function shortcode(url) {
  const match = /instagram\.com\/(?:[^/]+\/)?(?:p|reel|tv)\/([^/?#]+)/.exec(url);
  if (!match) throw new Error(`Not an Instagram post link: ${url}`);
  return match[1];
}

const wanted = new Map();
for (const c of continents) {
  if (c.postUrl) wanted.set(shortcode(c.postUrl), c.id);
}

const counts = Object.fromEntries(continents.map((c) => [c.id, 0]));
const found = new Set();

let url = new URL(`${GRAPH}/me/media`);
url.searchParams.set('fields', 'permalink,comments_count');
url.searchParams.set('limit', '50');
url.searchParams.set('access_token', token);

while (url && found.size < wanted.size) {
  const res = await fetch(url);
  const body = await res.json();
  // Errors print Instagram's message only; the request URL contains the token.
  if (!res.ok) throw new Error(`Instagram API ${res.status}: ${body.error?.message ?? 'unknown error'}`);
  for (const media of body.data) {
    const id = wanted.get(shortcode(media.permalink));
    if (id) {
      counts[id] = media.comments_count;
      found.add(id);
    }
  }
  url = body.paging?.next ? new URL(body.paging.next) : null;
}

const missing = [...wanted.values()].filter((id) => !found.has(id));
if (missing.length) {
  throw new Error(`Posts not found on this Instagram account: ${missing.join(', ')}`);
}

writeFileSync(outFile, `${JSON.stringify({ demo: false, updatedAt: new Date().toISOString(), counts }, null, 2)}\n`);
console.log(counts);
