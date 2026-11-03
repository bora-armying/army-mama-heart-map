(async function () {
  const TOKEN_KEY = 'army-mama-heart-map-token';
  const COUNTS_PATH = 'data/counts.json';

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => n.toLocaleString('en-US');

  const [challenge, published] = await Promise.all([
    fetch('data/challenge.json').then((r) => r.json()),
    fetch(`${COUNTS_PATH}?t=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json()),
  ]);
  const continents = challenge.continents;
  const repo = challenge.repo || repoFromLocation();
  // npm start: saves go to scripts/dev-server.mjs and never reach the live site.
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  const api = isLocal ? '/local-api/' : `https://api.github.com/repos/${repo}/contents/`;

  // owner.github.io/repo/ names the repo, so no setup is needed on GitHub Pages.
  function repoFromLocation() {
    const owner = /^([^.]+)\.github\.io$/.exec(location.hostname);
    const name = location.pathname.split('/')[1];
    return owner && name && !name.includes('.') ? `${owner[1]}/${name}` : '';
  }

  function storedToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  }

  function storeToken(value) {
    try {
      if (value) localStorage.setItem(TOKEN_KEY, value);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Storage blocked; the token just has to be pasted again next time.
    }
  }

  function status(message, kind = '') {
    $('status').textContent = message;
    $('status').dataset.kind = kind;
  }

  // ---- Form ----
  const PLATFORMS = [['instagram', 'Instagram'], ['tiktok', 'TikTok']];

  // Saves from before TikTok was added only have one number, all from Instagram.
  function savedCount(c, platform) {
    const saved = published.sources?.[c.id]?.[platform];
    if (saved !== undefined) return saved;
    return platform === 'instagram' ? published.counts[c.id] ?? 0 : 0;
  }

  const head = document.createElement('div');
  head.className = 'admin-field';
  head.setAttribute('aria-hidden', 'true');
  head.append(document.createElement('span'));
  for (const [, name] of PLATFORMS) {
    const heading = document.createElement('span');
    heading.className = 'admin-head';
    heading.textContent = name;
    head.append(heading);
  }
  $('fields').append(head);

  for (const c of continents) {
    const row = document.createElement('div');
    row.className = 'admin-field';
    const label = document.createElement('label');
    label.htmlFor = `count-${c.id}-instagram`;
    label.textContent = c.name;
    row.append(label);
    for (const [platform, name] of PLATFORMS) {
      const input = document.createElement('input');
      input.id = `count-${c.id}-${platform}`;
      input.type = 'text';
      input.inputMode = 'numeric';
      input.autocomplete = 'off';
      input.setAttribute('aria-label', `${c.name} ${name} comments`);
      // Sample counts must never be saved as real ones, so start empty.
      input.value = published.demo ? '' : String(savedCount(c, platform));
      input.addEventListener('input', () => {
        confirmedDrop = '';
        updateTotal();
      });
      row.append(input);
    }
    $('fields').append(row);
  }

  function readCounts() {
    const counts = {};
    const sources = {};
    const bad = [];
    for (const c of continents) {
      sources[c.id] = {};
      counts[c.id] = 0;
      for (const [platform, name] of PLATFORMS) {
        // The apps show counts like 1,234, so commas are fine.
        const text = $(`count-${c.id}-${platform}`).value.replace(/[,\s]/g, '');
        const n = Number(text);
        if (!/^\d+$/.test(text) || !Number.isSafeInteger(n)) {
          bad.push(`${c.name} ${name}`);
        } else {
          sources[c.id][platform] = n;
          counts[c.id] += n;
        }
      }
    }
    return { counts, sources, bad };
  }

  function updateTotal() {
    const { counts } = readCounts();
    $('total').textContent = fmt(Object.values(counts).reduce((a, b) => a + b, 0));
  }

  function showForget() {
    $('forget').hidden = !storedToken();
  }

  $('token').value = storedToken();
  showForget();
  updateTotal();
  $('forget').addEventListener('click', () => {
    storeToken('');
    $('token').value = '';
    showForget();
    status('Saved token removed from this device.');
  });

  $('practice').hidden = !isLocal;
  $('token-section').hidden = isLocal;

  if (!repo && !isLocal) {
    status('Open this page on the published site to save counts.', 'error');
    $('save').disabled = true;
  }

  // ---- Saving ----
  function apiError(code) {
    if (code === 401) return 'GitHub rejected the token. Check that it was pasted in full and hasn\'t expired.';
    if (code === 403) return 'This token can\'t change the site. It needs Contents set to "Read and write" on this repo.';
    if (code === 404) return `GitHub can't find ${repo} with this token. Check that the token includes this repo.`;
    if (code === 409) return 'Someone else saved at the same moment. Press Save again.';
    return `GitHub returned an error (${code}). Nothing was saved. Try again in a minute.`;
  }

  async function github(path, options = {}) {
    const res = await fetch(`${api}${path}`, {
      cache: 'no-store',
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${$('token').value.trim()}`,
        ...options.headers,
      },
    });
    if (!res.ok) throw new Error(apiError(res.status));
    return res.json();
  }

  // A lower number is usually a typo, so it takes a second press to save.
  let confirmedDrop = '';

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { counts, sources, bad } = readCounts();
    if (bad.length) return status(`Enter a whole number for ${bad.join(', ')}. Use 0 if there are no comments yet.`, 'error');
    if (!isLocal && !$('token').value.trim()) return status('Paste your GitHub access token first.', 'error');

    $('save').disabled = true;
    status('Saving...');
    try {
      const current = await github(COUNTS_PATH);
      const live = JSON.parse(atob(current.content.replace(/\n/g, '')));
      const drops = live.demo
        ? []
        : continents.filter((c) => counts[c.id] < (live.counts[c.id] ?? 0));
      const dropKey = JSON.stringify(counts);
      if (drops.length && confirmedDrop !== dropKey) {
        confirmedDrop = dropKey;
        const list = drops.map((c) => `${c.name} from ${fmt(live.counts[c.id])} to ${fmt(counts[c.id])}`).join(', ');
        status(`This lowers ${list}, which removes hearts. Press Save again to confirm.`, 'error');
        return;
      }
      const body = { demo: false, updatedAt: new Date().toISOString(), counts, sources };
      await github(COUNTS_PATH, {
        method: 'PUT',
        body: JSON.stringify({
          message: 'Update heart counts',
          content: btoa(`${JSON.stringify(body, null, 2)}\n`),
          sha: current.sha,
        }),
      });
      confirmedDrop = '';
      if (isLocal) return status('Saved on this computer. Open or reload the map to see it.', 'success');
      storeToken($('remember').checked ? $('token').value.trim() : '');
      showForget();
      status('Saved. The map updates in about 2 minutes.', 'success');
    } catch (err) {
      status(err instanceof TypeError ? 'Couldn\'t reach GitHub. Check your connection and try again.' : err.message, 'error');
    } finally {
      $('save').disabled = !repo && !isLocal;
    }
  });
})();
