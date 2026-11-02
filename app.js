(async function () {
  const POLL_MS = 60000;
  const MAX_DRAWN = 50000; // per continent; past this the land is solid glow anyway
  const WORLD = { w: 1000, h: 500 };
  const DETAIL = { w: 1000, h: 640 };
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Map centre for each continent's close-up, and where its world-map label sits.
  const GEO = {
    asia: { center: [92, 35], label: [95, 45] },
    europe: { center: [18, 52], label: [18, 52] },
    africa: { center: [20, 2], label: [20, 5] },
    'north-america': { center: [-95, 45], label: [-100, 45] },
    'south-america': { center: [-60, -20], label: [-60, -15] },
    oceania: { center: [145, -22], label: [135, -25] },
  };

  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const fmt = (n) => n.toLocaleString('en-US');

  const [challenge, shapes, initial] = await Promise.all([
    fetch('data/challenge.json').then((r) => r.json()),
    fetch('data/continents.json').then((r) => r.json()),
    fetchCounts(),
  ]);
  const continents = challenge.continents;
  const byId = Object.fromEntries(continents.map((c) => [c.id, c]));
  const profileUrl = `https://www.instagram.com/${challenge.instagram}/`;
  let counts = initial.counts;
  let demo = initial.demo;
  let updatedAt = initial.updatedAt;

  function fetchCounts() {
    return fetch(`data/counts.json?t=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json());
  }

  // ---- Projections ----
  const RAD = Math.PI / 180;

  function equalEarth([lon, lat]) {
    const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;
    const l = Math.asin(M * Math.sin(lat * RAD));
    const l2 = l * l, l6 = l2 * l2 * l2;
    return [
      (lon * RAD * Math.cos(l)) / (M * (A1 + 3 * A2 * l2 + l6 * (7 * A3 + 9 * A4 * l2))),
      -l * (A1 + A2 * l2 + l6 * (A3 + A4 * l2)),
    ];
  }

  function lambert([lon0, lat0]) {
    const s0 = Math.sin(lat0 * RAD), c0 = Math.cos(lat0 * RAD);
    return ([lon, lat]) => {
      const d = (lon - lon0) * RAD;
      const s = Math.sin(lat * RAD), c = Math.cos(lat * RAD), cd = Math.cos(d);
      const k = Math.sqrt(2 / (1 + s0 * s + c0 * c * cd));
      return [k * c * Math.sin(d), -k * (c0 * s - s0 * c * cd)];
    };
  }

  function angularDistance([lon0, lat0], [lon, lat]) {
    const cos = Math.sin(lat0 * RAD) * Math.sin(lat * RAD)
      + Math.cos(lat0 * RAD) * Math.cos(lat * RAD) * Math.cos((lon - lon0) * RAD);
    return Math.acos(Math.min(1, Math.max(-1, cos))) / RAD;
  }

  function percentile(sorted, p) {
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  }

  // Fits to the 1st-99th percentile of coastline so far-flung islands don't shrink the mainland.
  function fit(project, polygons, size, pad, trim) {
    const xs = [], ys = [];
    for (const rings of polygons) {
      for (const pt of rings[0]) {
        const [x, y] = project(pt);
        xs.push(x);
        ys.push(y);
      }
    }
    xs.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);
    const [x0, x1] = [percentile(xs, trim), percentile(xs, 1 - trim)];
    const [y0, y1] = [percentile(ys, trim), percentile(ys, 1 - trim)];
    const k = Math.min((size.w - pad * 2) / (x1 - x0), (size.h - pad * 2) / (y1 - y0));
    const dx = size.w / 2 - (k * (x0 + x1)) / 2;
    const dy = size.h / 2 - (k * (y0 + y1)) / 2;
    return (pt) => {
      const [x, y] = project(pt);
      return [k * x + dx, k * y + dy];
    };
  }

  function buildPath(project, polygons, keep) {
    const path = new Path2D();
    for (const rings of polygons) {
      if (keep && !rings[0].every(keep)) continue;
      for (const ring of rings) {
        ring.forEach((pt, i) => {
          const [x, y] = project(pt);
          if (i) path.lineTo(x, y);
          else path.moveTo(x, y);
        });
        path.closePath();
      }
    }
    return path;
  }

  // ---- Heart placement ----
  // Heart number k on a continent always lands on the same spot, so hearts already
  // lit never move when new comments arrive. Halton points spread evenly as they fill.
  function halton(i, base) {
    let f = 1, r = 0;
    while (i > 0) {
      f /= base;
      r += f * (i % base);
      i = Math.floor(i / base);
    }
    return r;
  }

  function buildSpots(path, size, seed) {
    const mask = document.createElement('canvas');
    mask.width = size.w;
    mask.height = size.h;
    const m = mask.getContext('2d', { willReadFrequently: true });
    m.fill(path);
    const data = m.getImageData(0, 0, size.w, size.h).data;
    let area = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 127) area++;
    const isLand = (x, y) => data[(Math.floor(y) * size.w + Math.floor(x)) * 4 + 3] > 127;
    const spots = [];
    let cursor = 1;
    return {
      area,
      isLand,
      spots,
      ensure(n) {
        // Bounded: a continent cropped to almost nothing can't spin forever.
        let budget = Math.max(2000, n * 200);
        while (spots.length < n && area > 0 && budget-- > 0) {
          const i = cursor++;
          const x = ((halton(i, 2) + seed * 0.137) % 1) * size.w;
          const y = ((halton(i, 3) + seed * 0.271) % 1) * size.h;
          if (isLand(x, y)) spots.push({ x, y, wobble: 0.8 + halton(i, 5) * 0.4 });
        }
      },
    };
  }

  // One size per view, set by the most crowded continent, so a heart looks the
  // same everywhere and more comments always read as more light.
  function heartSize(view) {
    let room = Infinity;
    for (const [id, layer] of Object.entries(view.layers)) {
      const n = Math.min(counts[id] ?? 0, MAX_DRAWN);
      if (n) room = Math.min(room, Math.sqrt(layer.area / n));
    }
    return Math.max(4, Math.min(16, 0.8 * room));
  }

  // ---- Heart sprite: bright core, purple glow ----
  const SPRITE = 96;
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = SPRITE;
  {
    const s = sprite.getContext('2d');
    const heart = new Path2D('M0 -8C-5 -16 -18 -13 -18 -2C-18 7 -7 13 0 19C7 13 18 7 18 -2C18 -13 5 -16 0 -8Z');
    s.translate(SPRITE / 2, SPRITE / 2);
    s.scale(1.25, 1.25);
    s.shadowColor = '#b26bff';
    s.shadowBlur = 26;
    s.fillStyle = '#b26bff';
    s.fill(heart);
    s.shadowBlur = 10;
    s.fillStyle = '#c690ff';
    s.fill(heart);
    s.shadowBlur = 0;
    const g = s.createRadialGradient(0, 0, 2, 0, 0, 20);
    g.addColorStop(0, '#fff4ff');
    g.addColorStop(1, '#c690ff');
    s.fillStyle = g;
    s.fill(heart);
  }

  function drawHeart(c, x, y, size, alpha) {
    const d = size * 2.4; // the sprite's glow extends past the heart itself
    c.globalAlpha = alpha;
    c.drawImage(sprite, x - d / 2, y - d / 2, d, d);
    c.globalAlpha = 1;
  }

  // ---- Views ----
  const views = {};

  function getView(id) {
    if (views[id]) return views[id];
    const view = id === 'world' ? buildWorldView() : buildDetailView(id);
    views[id] = view;
    return view;
  }

  function buildWorldView() {
    const all = Object.values(shapes).flat();
    const project = fit(equalEarth, all, WORLD, 14, 0.001);
    const layers = {};
    continents.forEach((c, i) => {
      const path = buildPath(project, shapes[c.id]);
      layers[c.id] = { path, ...buildSpots(path, WORLD, i + 1) };
    });
    return {
      size: WORLD,
      background: [],
      layers,
      chips: continents.map((c) => {
        const [x, y] = project(GEO[c.id].label);
        return { id: c.id, x: x / WORLD.w, y: y / WORLD.h };
      }),
    };
  }

  function buildDetailView(id) {
    const center = GEO[id].center;
    const near = (pt) => angularDistance(center, pt) < 100;
    const nearPolys = shapes[id].filter((rings) => rings[0].every(near));
    const project = fit(lambert(center), nearPolys, DETAIL, 28, 0.01);
    const others = Object.keys(shapes).filter((k) => k !== id).flatMap((k) => shapes[k]);
    const path = buildPath(project, shapes[id], near);
    return {
      size: DETAIL,
      background: [buildPath(project, others, near)],
      layers: { [id]: { path, ...buildSpots(path, DETAIL, continents.findIndex((c) => c.id === id) + 1) } },
      chips: [],
    };
  }

  // ---- Rendering ----
  let current = routeFromHash();
  let staticLayer = null;
  const popping = []; // newly lit hearts: { id, spot, size, start }
  const twinkles = [];
  let rafId = null;

  function resize() {
    const view = getView(current);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const cssWidth = $('map').clientWidth;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round((cssWidth * view.size.h) / view.size.w * dpr);
    renderStatic();
  }

  function drawMap(c, view) {
    c.fillStyle = 'rgba(255, 255, 255, 0.06)';
    view.background.forEach((p) => c.fill(p));
    const size = heartSize(view);
    for (const [id, layer] of Object.entries(view.layers)) {
      c.fillStyle = 'rgba(217, 200, 245, 0.2)';
      c.fill(layer.path);
      const n = Math.min(counts[id] ?? 0, MAX_DRAWN);
      layer.ensure(n);
      for (let i = 0; i < Math.min(n, layer.spots.length); i++) {
        const spot = layer.spots[i];
        drawHeart(c, spot.x, spot.y, size * spot.wobble, 0.92);
      }
    }
  }

  function renderStatic() {
    const view = getView(current);
    staticLayer = document.createElement('canvas');
    staticLayer.width = canvas.width;
    staticLayer.height = canvas.height;
    const c = staticLayer.getContext('2d');
    const scale = canvas.width / view.size.w;
    c.scale(scale, scale);
    drawMap(c, view);
    twinkles.length = 0;
    const size = heartSize(view);
    for (const [id, layer] of Object.entries(view.layers)) {
      const n = Math.min(counts[id] ?? 0, MAX_DRAWN);
      // A small rotating set shimmers; animating all of them would be wasted work.
      const step = Math.max(1, Math.floor(n / 24));
      for (let i = 0; i < n && i < layer.spots.length; i += step) {
        twinkles.push({ spot: layer.spots[i], size: size * layer.spots[i].wobble, phase: i * 1.7 });
      }
    }
    paint(performance.now());
  }

  function paint(now) {
    const view = getView(current);
    const scale = canvas.width / view.size.w;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (staticLayer) ctx.drawImage(staticLayer, 0, 0);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (!reduceMotion) {
      for (const t of twinkles) {
        const a = Math.max(0, Math.sin(now / 900 + t.phase));
        if (a > 0.05) drawHeart(ctx, t.spot.x, t.spot.y, t.size * 1.35, a * 0.8);
      }
    }
    for (let i = popping.length - 1; i >= 0; i--) {
      const p = popping[i];
      const t = (now - p.start) / 1400;
      if (t >= 1 || !view.layers[p.id]) {
        popping.splice(i, 1);
        continue;
      }
      if (t < 0) continue; // staggered, not started yet
      // Starts large and settles to the heart's resting size.
      drawHeart(ctx, p.spot.x, p.spot.y, p.size * (1 + 3.5 * (1 - t) * (1 - t)), Math.min(1, 1.6 - t));
    }
  }

  function loop(now) {
    paint(now);
    rafId = reduceMotion && !popping.length ? null : requestAnimationFrame(loop);
  }

  function startLoop() {
    if (rafId === null) rafId = requestAnimationFrame(loop);
  }

  // ---- Saved image: a 4:5 Instagram post of whichever map is showing ----
  const IMAGE = { w: 1080, h: 1350, font: '"Open Sans", "Segoe UI", sans-serif' };

  function loadHeadline() {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = $('headline').src;
    });
  }

  async function renderImage() {
    await Promise.all([
      document.fonts.load(`800 40px ${IMAGE.font}`),
      document.fonts.load(`600 28px ${IMAGE.font}`),
    ]);
    const headline = await loadHeadline();
    const out = document.createElement('canvas');
    out.width = IMAGE.w;
    out.height = IMAGE.h;
    const c = out.getContext('2d');
    const text = (value, x, y, size, weight, color, align = 'center') => {
      c.font = `${weight} ${size}px ${IMAGE.font}`;
      c.fillStyle = color;
      c.textAlign = align;
      c.fillText(value, x, y);
    };

    const sky = c.createLinearGradient(0, 0, IMAGE.w, IMAGE.h);
    sky.addColorStop(0, '#7b4fc9');
    sky.addColorStop(0.22, '#4b2496');
    sky.addColorStop(0.55, '#2f1270');
    sky.addColorStop(1, '#1d0a4d');
    c.fillStyle = sky;
    c.fillRect(0, 0, IMAGE.w, IMAGE.h);

    const view = getView(current);
    const isWorld = current === 'world';
    const mapW = 1000;
    const mapH = (view.size.h / view.size.w) * mapW;
    const rowH = 60;
    const rowsH = isWorld ? 44 + rowH * 3 : 0;

    const headW = 760;
    const headH = (headline.naturalHeight / headline.naturalWidth) * headW;
    // Centres everything above the footer line, whichever map is showing.
    const blockH = headH + 62 + 26 + mapH + rowsH;
    const top = Math.max(36, (IMAGE.h - 80 - blockH) / 2);
    c.drawImage(headline, (IMAGE.w - headW) / 2, top, headW, headH);

    const n = isWorld ? total() : counts[current] ?? 0;
    const place = isWorld ? '' : ` in ${byId[current].name}`;
    let y = top + headH + 62;
    text(`${fmt(n)} purple ${n === 1 ? 'heart' : 'hearts'} lit${place}`, IMAGE.w / 2, y, 40, 800, '#ffdc5e');

    y += 26;
    const mapX = (IMAGE.w - mapW) / 2;
    c.fillStyle = 'rgba(29, 10, 77, 0.55)';
    c.fillRect(mapX, y, mapW, mapH);
    c.save();
    c.beginPath();
    c.rect(mapX, y, mapW, mapH);
    c.clip();
    c.translate(mapX, y);
    c.scale(mapW / view.size.w, mapW / view.size.w);
    drawMap(c, view);
    c.restore();
    y += mapH;

    if (isWorld) {
      const ranked = [...continents].sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0));
      const firstRow = y + 66;
      ranked.forEach((co, i) => {
        const col = i % 2;
        const rowY = firstRow + Math.floor(i / 2) * rowH;
        const left = col ? 580 : 40;
        const right = col ? 1040 : 500;
        text(co.name, left, rowY, 34, 600, '#ffffff', 'left');
        text(fmt(counts[co.id] ?? 0), right, rowY, 34, 800, '#ffdc5e', 'right');
      });
    }

    const stamp = new Date(updatedAt || Date.now()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    text(`@${challenge.instagram}  ·  Updated ${stamp}`, IMAGE.w / 2, IMAGE.h - 40, 26, 600, '#d9c8f5');

    // Sample numbers must never pass for real ones if the image gets posted.
    if (demo) {
      c.save();
      c.translate(IMAGE.w / 2, y - mapH / 2);
      c.rotate(-0.2);
      text('SAMPLE, NOT REAL COUNTS', 0, 0, 64, 800, 'rgba(255, 220, 94, 0.85)');
      c.restore();
    }
    return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
  }

  async function saveImage() {
    const button = $('save-image');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Preparing image...';
    try {
      const blob = await renderImage();
      const day = new Date().toLocaleDateString('en-CA'); // local date, as YYYY-MM-DD
      const name = `army-heart-map-${current}-${day}.png`;
      const file = new File([blob], name, { type: 'image/png' });
      // On phones the share sheet is what offers Save Image to the photo library.
      if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      if (err.name !== 'AbortError') { // AbortError: the share sheet was closed
        button.textContent = 'Couldn\'t save. Try again.';
        setTimeout(() => { button.textContent = label; }, 3000);
        return;
      }
    } finally {
      button.disabled = false;
    }
    button.textContent = label;
  }

  // ---- UI ----
  function routeFromHash() {
    const id = location.hash.slice(1);
    return GEO[id] ? id : 'world';
  }

  function total() {
    return continents.reduce((sum, c) => sum + (counts[c.id] ?? 0), 0);
  }

  function hearts(n) {
    return `${fmt(n)} ${n === 1 ? 'heart' : 'hearts'}`;
  }

  function renderTabs() {
    const tabs = $('tabs');
    tabs.replaceChildren();
    for (const { id, name } of [{ id: 'world', name: 'World' }, ...continents]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = name;
      b.setAttribute('aria-pressed', String(id === current));
      b.addEventListener('click', () => go(id));
      tabs.append(b);
    }
  }

  function renderChips() {
    const holder = $('chips');
    holder.replaceChildren();
    for (const chip of getView(current).chips) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.style.left = `${chip.x * 100}%`;
      b.style.top = `${chip.y * 100}%`;
      b.setAttribute('aria-label', `${byId[chip.id].name}: ${hearts(counts[chip.id] ?? 0)}. Open map.`);
      const count = document.createElement('b');
      count.textContent = fmt(counts[chip.id] ?? 0);
      b.append(`${byId[chip.id].name} `, count);
      b.addEventListener('click', () => go(chip.id));
      holder.append(b);
    }
  }

  function renderCaption() {
    const caption = $('caption');
    const cta = $('caption-cta');
    const count = document.createElement('b');
    if (current === 'world') {
      count.textContent = hearts(total());
      caption.replaceChildren(count, ' lit across six continents. Pick yours to see it up close.');
      cta.hidden = true;
      canvas.setAttribute('aria-label', `World map with ${hearts(total())} lit.`);
    } else {
      const c = byId[current];
      const n = counts[current] ?? 0;
      count.textContent = hearts(n);
      caption.replaceChildren(
        ...(n ? [count, ` lit in ${c.name}.`] : [`No hearts in ${c.name} yet. Yours can be the first.`]),
      );
      cta.hidden = false;
      cta.href = c.postUrl || profileUrl;
      cta.textContent = c.postUrl ? `Comment on the ${c.name} post` : `Open @${challenge.instagram}`;
      canvas.setAttribute('aria-label', `Map of ${c.name} with ${hearts(n)} lit.`);
    }
    $('simulate').hidden = !demo;
  }

  function renderPosts() {
    const list = $('posts');
    list.replaceChildren();
    const ranked = [...continents].sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0));
    for (const c of ranked) {
      const li = document.createElement('li');
      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'post-name';
      name.textContent = c.name;
      name.addEventListener('click', () => {
        go(c.id);
        $('map').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      });
      const count = document.createElement('span');
      count.className = 'post-count';
      count.textContent = fmt(counts[c.id] ?? 0);
      const link = document.createElement('a');
      link.className = 'post-link';
      link.target = '_blank';
      link.rel = 'noopener';
      link.href = c.postUrl || profileUrl;
      link.textContent = c.postUrl ? 'Comment on this post on Instagram' : `Post coming soon on @${challenge.instagram}`;
      li.append(name, count, link);
      list.append(li);
    }
  }

  function renderMeta() {
    $('total').textContent = fmt(total());
    $('demo-note').hidden = !demo;
    $('updated').textContent = updatedAt
      ? `Hearts last updated ${new Date(updatedAt).toLocaleString()}.`
      : '';
  }

  function renderText() {
    renderChips();
    renderCaption();
    renderPosts();
    renderMeta();
  }

  function go(id) {
    current = id;
    history.replaceState(null, '', id === 'world' ? location.pathname + location.search : `#${id}`);
    show();
  }

  function show() {
    popping.length = 0;
    renderTabs();
    renderText();
    resize();
    startLoop();
  }

  // Applies new counts, flaring only the hearts that were just lit.
  function applyCounts(next) {
    const before = counts;
    counts = next;
    const view = getView(current);
    const now = performance.now();
    const size = heartSize(view);
    for (const [id, layer] of Object.entries(view.layers)) {
      const from = Math.min(before[id] ?? 0, MAX_DRAWN);
      const to = Math.min(next[id] ?? 0, MAX_DRAWN);
      if (to <= from) continue;
      layer.ensure(to);
      // A big jump between refreshes shouldn't flare thousands at once.
      for (let i = Math.max(from, to - 60); i < to && i < layer.spots.length; i++) {
        const spot = layer.spots[i];
        popping.push({ id, spot, size: size * spot.wobble, start: now + (i - from) * 40 });
      }
    }
    renderText();
    renderStatic();
    startLoop();
  }

  canvas.addEventListener('click', (e) => {
    if (current !== 'world') return;
    const hit = hitTest(e);
    if (hit) go(hit);
  });
  canvas.addEventListener('mousemove', (e) => {
    canvas.style.cursor = current === 'world' && hitTest(e) ? 'pointer' : 'default';
  });

  function hitTest(e) {
    const rect = canvas.getBoundingClientRect();
    const view = getView(current);
    const x = ((e.clientX - rect.left) / rect.width) * view.size.w;
    const y = ((e.clientY - rect.top) / rect.height) * view.size.h;
    return Object.keys(view.layers).find((id) => view.layers[id].isLand(x, y));
  }

  $('simulate').addEventListener('click', () => {
    const ids = current === 'world' ? continents.map((c) => c.id) : [current];
    const id = ids[Math.floor(Math.random() * ids.length)];
    applyCounts({ ...counts, [id]: (counts[id] ?? 0) + 1 });
  });

  $('save-image').addEventListener('click', saveImage);

  $('ig-link').href = profileUrl;
  $('ig-link').textContent = `@${challenge.instagram}`;
  if (challenge.voteUrl) {
    const vote = document.createElement('a');
    vote.href = challenge.voteUrl;
    vote.target = '_blank';
    vote.rel = 'noopener';
    vote.textContent = $('vote-step').textContent;
    $('vote-step').replaceChildren(vote);
  }

  let resizeTimer;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });
  addEventListener('hashchange', () => {
    current = routeFromHash();
    show();
  });

  // Real counts only: polling would wipe out simulated hearts on the sample data.
  setInterval(async () => {
    if (document.hidden) return;
    try {
      const fresh = await fetchCounts();
      const wasDemo = demo;
      demo = fresh.demo;
      updatedAt = fresh.updatedAt;
      if (!demo || !wasDemo) applyCounts(fresh.counts);
    } catch {
      // Offline or mid-deploy; the next poll tries again.
    }
  }, POLL_MS);

  show();
})();
