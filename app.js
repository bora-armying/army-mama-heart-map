(async function () {
  const POLL_MS = 60000;
  const MAX_DRAWN = 50000; // per continent; past this the land is solid glow anyway
  const WORLD = { w: 1000, h: 500 };
  const DETAIL = { w: 1000, h: 640 };
  const DETAIL_PHONE = { w: 1000, h: 1000 }; // tall screens have the height to spare
  const phone = matchMedia('(max-width: 720px)');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SONG_VIDEO = 'Fw7C6IsDYgI';
  const BEAT_MS = 1600;
  const REVEAL_MS = 1100;
  const POP_MS = 1000;
  const FLOATER_MS = 420;
  const MAX_PARTICLES = 150;

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

  function getView(id, phoneLayout = phone.matches) {
    const key = id === 'world' ? id : `${id}:${phoneLayout ? 'phone' : 'wide'}`;
    views[key] ??= id === 'world' ? buildWorldView() : buildDetailView(id, phoneLayout ? DETAIL_PHONE : DETAIL);
    return views[key];
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

  function buildDetailView(id, size) {
    const center = GEO[id].center;
    const near = (pt) => angularDistance(center, pt) < 100;
    const nearPolys = shapes[id].filter((rings) => rings[0].every(near));
    const project = fit(lambert(center), nearPolys, size, 28, 0.01);
    const others = Object.keys(shapes).filter((k) => k !== id).flatMap((k) => shapes[k]);
    const path = buildPath(project, shapes[id], near);
    return {
      size,
      background: [buildPath(project, others, near)],
      layers: { [id]: { path, ...buildSpots(path, size, continents.findIndex((c) => c.id === id) + 1) } },
      chips: [],
    };
  }

  // ---- Rendering ----
  let current = routeFromHash();
  let landLayer = null;
  let staticLayer = null;
  const particles = []; // floating and bursting little hearts
  let lastFloater = 0;
  let revealStart = 0;
  const popping = []; // newly lit hearts: { id, spot, size, start }
  const twinkles = [];
  let rafId = null;

  function resize() {
    const view = getView(current);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const cssWidth = $('map-inner').clientWidth;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round((cssWidth * view.size.h) / view.size.w * dpr);
    renderStatic();
  }

  function drawLand(c, view) {
    c.fillStyle = 'rgba(255, 255, 255, 0.06)';
    view.background.forEach((p) => c.fill(p));
    c.fillStyle = 'rgba(217, 200, 245, 0.2)';
    Object.values(view.layers).forEach((layer) => c.fill(layer.path));
  }

  function drawHearts(c, view) {
    const size = heartSize(view);
    for (const [id, layer] of Object.entries(view.layers)) {
      const n = Math.min(counts[id] ?? 0, MAX_DRAWN);
      layer.ensure(n);
      for (let i = 0; i < Math.min(n, layer.spots.length); i++) {
        const spot = layer.spots[i];
        drawHeart(c, spot.x, spot.y, size * spot.wobble, 0.92);
      }
    }
  }

  function drawMap(c, view) {
    drawLand(c, view);
    drawHearts(c, view);
  }

  function makeLayer(view, draw) {
    const layer = document.createElement('canvas');
    layer.width = canvas.width;
    layer.height = canvas.height;
    const c = layer.getContext('2d');
    const scale = canvas.width / view.size.w;
    c.scale(scale, scale);
    draw(c, view);
    return layer;
  }

  function renderStatic() {
    const view = getView(current);
    landLayer = makeLayer(view, drawLand);
    staticLayer = makeLayer(view, drawHearts);
    twinkles.length = 0;
    const size = heartSize(view);
    for (const [id, layer] of Object.entries(view.layers)) {
      const n = Math.min(counts[id] ?? 0, MAX_DRAWN);
      // A small set does the animating; moving all of them would be wasted work.
      const step = Math.max(1, Math.floor(n / 24));
      for (let i = 0; i < n && i < layer.spots.length; i += step) {
        twinkles.push({ spot: layer.spots[i], size: size * layer.spots[i].wobble, phase: (i * 317) % BEAT_MS });
      }
    }
    paint(performance.now());
  }

  // ---- Animation ----
  // A heartbeat: two quick bumps, then a rest. Returns 0 to about 1.
  function beat(ms) {
    const p = (ms % BEAT_MS) / BEAT_MS;
    return Math.exp(-(((p - 0.08) / 0.05) ** 2)) + 0.7 * Math.exp(-(((p - 0.24) / 0.06) ** 2));
  }

  function addParticle(fields, now) {
    if (particles.length < MAX_PARTICLES) particles.push({ born: now, vx: 0, sway: 0, gravity: 0, ...fields });
  }

  function burst(x, y, size, now) {
    for (let i = 0; i < 7; i++) {
      const angle = (i / 7) * Math.PI * 2 + Math.random() * 0.5;
      const speed = 60 + Math.random() * 50;
      addParticle({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30,
        gravity: 110,
        size: Math.max(size * 0.7, 6),
        life: 0.9,
      }, now);
    }
  }

  // Every so often a lit heart lets a little one float away.
  function spawnFloater(now) {
    if (now - lastFloater < FLOATER_MS || !twinkles.length) return;
    lastFloater = now;
    const { spot, size } = twinkles[Math.floor(Math.random() * twinkles.length)];
    addParticle({
      x: spot.x,
      y: spot.y,
      vy: -22 - Math.random() * 14,
      sway: 5 + Math.random() * 6,
      size: Math.max(size * 1.1, 8),
      life: 2.6,
    }, now);
  }

  function paintParticles(now) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      const age = (now - p.born) / 1000;
      if (age >= p.life) {
        particles.splice(i, 1);
        continue;
      }
      const t = age / p.life;
      const x = p.x + p.vx * age + p.sway * Math.sin(age * 3.2);
      const y = p.y + p.vy * age + 0.5 * p.gravity * age * age;
      // Swells in quickly, fades out over the second half of its life.
      drawHeart(ctx, x, y, p.size * Math.min(1, t * 8) * (1 - t * 0.4), Math.min(1, 2 - t * 2));
    }
  }

  function paint(now) {
    const view = getView(current);
    const scale = canvas.width / view.size.w;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (landLayer) ctx.drawImage(landLayer, 0, 0);
    const reveal = reduceMotion ? 1 : (now - revealStart) / REVEAL_MS;
    if (staticLayer && reveal < 1) {
      // Hearts light up in a ring spreading out from the middle of the map.
      const eased = 1 - (1 - Math.max(0, reveal)) ** 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(canvas.width / 2, canvas.height / 2, eased * Math.hypot(canvas.width, canvas.height) * 0.55, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(staticLayer, 0, 0);
      ctx.restore();
    } else if (staticLayer) {
      ctx.drawImage(staticLayer, 0, 0);
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (!reduceMotion && reveal >= 1) {
      for (const t of twinkles) {
        const a = beat(now + t.phase);
        if (a > 0.05) drawHeart(ctx, t.spot.x, t.spot.y, t.size * (1 + 0.5 * a), Math.min(1, a) * 0.9);
      }
      spawnFloater(now);
    }
    if (!reduceMotion) paintParticles(now);
    for (let i = popping.length - 1; i >= 0; i--) {
      const p = popping[i];
      const t = (now - p.start) / POP_MS;
      if (t >= 1 || !view.layers[p.id]) {
        popping.splice(i, 1);
        continue;
      }
      if (t < 0) continue; // staggered, not started yet
      if (!p.burst) {
        p.burst = true;
        burst(p.spot.x, p.spot.y, p.size, now);
      }
      // Bounces in big, then wobbles down to the heart's resting size.
      const bounce = 1 + 3 * Math.exp(-4.5 * t) * Math.abs(Math.cos(9 * t));
      drawHeart(ctx, p.spot.x, p.spot.y, p.size * bounce, 1 - t * t);
    }
  }

  function loop(now) {
    paint(now);
    rafId = reduceMotion ? null : requestAnimationFrame(loop);
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
      img.src = 'assets/headline.png'; // the white lettering, for the purple image
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

    const view = getView(current, false); // the image keeps one layout on every device
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
      $('caption-tiktok').hidden = true;
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
      cta.textContent = c.postUrl ? 'Comment on Instagram' : `Open @${challenge.instagram}`;
      $('caption-tiktok').hidden = !c.tiktokUrl;
      $('caption-tiktok').href = c.tiktokUrl;
      $('caption-tiktok').textContent = 'Comment on TikTok';
      canvas.setAttribute('aria-label', `Map of ${c.name} with ${hearts(n)} lit.`);
    }
    $('simulate').hidden = !demo;
  }

  // A small glowing outline of the continent for its post tile.
  const thumbs = {};

  function thumb(id) {
    if (thumbs[id]) return thumbs[id];
    const size = { w: 600, h: 320 };
    const center = GEO[id].center;
    const polygons = shapes[id].filter((rings) => rings[0].every((pt) => angularDistance(center, pt) < 100));
    const project = fit(lambert(center), polygons, size, 26, 0.01);
    const out = document.createElement('canvas');
    out.width = size.w;
    out.height = size.h;
    out.setAttribute('aria-hidden', 'true');
    const c = out.getContext('2d');
    const ink = c.createLinearGradient(0, 0, size.w, size.h);
    ink.addColorStop(0, '#7b4fc9');
    ink.addColorStop(1, '#2f1270');
    c.shadowColor = 'rgba(123, 79, 201, 0.55)';
    c.shadowBlur = 18;
    c.fillStyle = ink;
    c.fill(buildPath(project, polygons));
    thumbs[id] = out;
    return out;
  }

  function externalLink(className, href, text, label) {
    const link = document.createElement('a');
    link.className = className;
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = text;
    link.setAttribute('aria-label', label);
    return link;
  }

  function renderPosts() {
    const list = $('posts');
    list.replaceChildren();
    // Stays in a fixed order so people can find their continent at a glance.
    for (const c of continents) {
      const n = counts[c.id] ?? 0;
      const tile = document.createElement('div');
      tile.className = 'tile';
      const name = document.createElement('span');
      name.className = 'tile-name';
      name.textContent = c.name;
      const count = document.createElement('span');
      count.className = 'tile-count';
      const number = document.createElement('b');
      number.textContent = fmt(n);
      count.append(number, n === 1 ? ' heart' : ' hearts');
      tile.append(thumb(c.id), name, count);
      const posts = [['Instagram', c.postUrl], ['TikTok', c.tiktokUrl]].filter(([, url]) => url);
      if (posts.length) {
        const links = document.createElement('div');
        links.className = 'tile-links';
        for (const [label, url] of posts) links.append(externalLink('tile-link', url, `${label} ↗`, `Comment on the ${c.name} post on ${label}`));
        tile.append(links);
      } else {
        const soon = document.createElement('span');
        soon.className = 'tile-action';
        soon.textContent = 'Posts coming soon';
        tile.append(soon);
      }
      const li = document.createElement('li');
      li.append(tile);
      list.append(li);
    }
  }

  function renderMeta() {
    $('total').textContent = fmt(total());
    $('demo-note').hidden = !demo;
    $('updated').textContent = updatedAt
      ? `Hearts last updated ${new Date(updatedAt).toLocaleString()}.`
      : '';
    $('footer').hidden = !updatedAt;
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
    particles.length = 0;
    revealStart = performance.now();
    $('map').classList.toggle('is-world', current === 'world');
    $('swipe-hint').hidden = current !== 'world';
    renderTabs();
    renderText();
    resize();
    // Start a panning map in the middle, with land on both sides to swipe to.
    $('map').scrollLeft = ($('map').scrollWidth - $('map').clientWidth) / 2;
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
      const first = Math.max(from, to - 60);
      for (let i = first; i < to && i < layer.spots.length; i++) {
        const spot = layer.spots[i];
        popping.push({ id, spot, size: size * spot.wobble, start: now + (i - first) * 40 });
      }
    }
    renderText();
    renderStatic();
    startLoop();
  }

  canvas.addEventListener('click', (e) => {
    const hit = hitTest(e);
    if (!hit) return;
    if (current === 'world') {
      go(hit);
    } else if (!reduceMotion) {
      const { x, y } = mapPoint(e);
      burst(x, y, heartSize(getView(current)), performance.now());
    }
  });
  canvas.addEventListener('mousemove', (e) => {
    canvas.style.cursor = hitTest(e) ? 'pointer' : 'default';
  });

  function mapPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const { size } = getView(current);
    return {
      x: ((e.clientX - rect.left) / rect.width) * size.w,
      y: ((e.clientY - rect.top) / rect.height) * size.h,
    };
  }

  function hitTest(e) {
    const view = getView(current);
    const { x, y } = mapPoint(e);
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
  if (challenge.tiktok) {
    const tiktok = document.createElement('a');
    tiktok.href = `https://www.tiktok.com/@${challenge.tiktok}`;
    tiktok.target = '_blank';
    tiktok.rel = 'noopener';
    tiktok.textContent = `@${challenge.tiktok}`;
    $('tiktok-step').replaceChildren(' or ', tiktok, ' on TikTok');
  }
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

  // ---- Song: a play button on the map, with YouTube's player running unseen ----
  function setUpSong(videoId) {
    let player = null;
    let startCheck = null;
    $('song-link').href = `https://www.youtube.com/watch?v=${videoId}`;

    function showFailure() {
      $('song-play').hidden = true;
      $('song-panel').classList.remove('is-open');
      $('song-link').hidden = false;
    }

    function showPlaying(playing) {
      const label = `${playing ? 'Pause' : 'Play'} Mikrokosmos by BTS`;
      // SVG elements have no .hidden property, so set the attribute itself.
      $('song-play-icon').toggleAttribute('hidden', playing);
      $('song-pause-icon').toggleAttribute('hidden', !playing);
      $('song-play').setAttribute('aria-label', label);
      $('song-play').title = label;
    }

    $('song-play').addEventListener('click', () => {
      if (player.getPlayerState() === YT.PlayerState.PLAYING) {
        player.pauseVideo();
      } else {
        player.playVideo();
        // If a phone blocks the start, show YouTube's own play button to tap.
        clearTimeout(startCheck);
        startCheck = setTimeout(() => {
          const state = player.getPlayerState();
          if (state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.BUFFERING) {
            $('song-panel').classList.add('is-open');
          }
        }, 3000);
      }
    });

    window.onYouTubeIframeAPIReady = () => {
      player = new YT.Player('song-player', {
        host: 'https://www.youtube-nocookie.com',
        videoId,
        playerVars: { controls: 0, loop: 1, playlist: videoId, playsinline: 1, rel: 0, origin: location.origin },
        events: {
          onReady: () => { $('song-play').disabled = false; },
          onStateChange: (e) => {
            showPlaying(e.data === YT.PlayerState.PLAYING);
            if (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.PAUSED) {
              clearTimeout(startCheck);
              $('song-panel').classList.remove('is-open');
            }
          },
          onError: showFailure,
        },
      });
    };

    const api = document.createElement('script');
    api.src = 'https://www.youtube.com/iframe_api';
    api.onerror = showFailure;
    document.head.append(api);
  }

  setUpSong(SONG_VIDEO);

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
