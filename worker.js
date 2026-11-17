// Worker utama: handle /api/* dan sisanya disajikan sebagai file statis dari dist/
// Env vars (set di Cloudflare dashboard → Settings → Variables & Secrets):
//   ADMIN_PASSWORD, ADMIN_SECRET, GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH (opsional, default main)

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function makeToken(password, env) {
  const data = new TextEncoder().encode(password + ':' + (env.ADMIN_SECRET || 'salt'));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function requireAuth(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  const expected = await makeToken(env.ADMIN_PASSWORD || '', env);
  return token && token === expected;
}

function ghHeaders(env) {
  return {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'User-Agent': 'cerita-web-admin',
    'Content-Type': 'application/json'
  };
}

function decodeB64(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  return decodeURIComponent(escape(bin));
}

function encodeB64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

function buildMarkdown({ title, date, tags, description, pinned, body }) {
  const tagList = (tags || '').split(',').map(t => t.trim()).filter(Boolean);
  // Timestamp otomatis (UTC) sebagai tie-breaker sorting saat tanggal sama
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  return [
    '---',
    `title: ${esc(title)}`,
    `description: ${esc(description || '')}`,
    `date: ${date}`,
    `timestamp: ${timestamp}`,
    `tags: [${tagList.join(', ')}]`,
    ...(pinned ? ['pinned: true'] : []),
    '---',
    '',
    body
  ].join('\n');
}

// POST /api/login
async function handleLogin(request, env) {
  const { password } = await request.json();
  if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
    return Response.json({ error: 'Password salah' }, { status: 401 });
  }
  return Response.json({ token: await makeToken(env.ADMIN_PASSWORD, env) });
}

// POST /api/post — tambah cerita baru ATAU update (jika body.slug ada)
async function handlePost(request, env) {
  if (!(await requireAuth(request, env))) {
    return Response.json({ error: 'Tidak terautentikasi' }, { status: 401 });
  }

  const { title, date, tags, description, body, slug } = await request.json();
  if (!title || !date || !body) {
    return Response.json({ error: 'Judul, tanggal, dan isi wajib diisi' }, { status: 400 });
  }

  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';
  if (!env.GITHUB_TOKEN || !repo) {
    return Response.json({ error: 'GITHUB_TOKEN / GITHUB_REPO belum di-set' }, { status: 500 });
  }

  const finalSlug = slug || slugify(title);
  const path = `content/${finalSlug}.md`;
  const content = encodeB64(buildMarkdown({ title, date, tags, description, pinned: false, body }));

  // Ambil sha jika file sudah ada (untuk update)
  let sha = undefined;
  const checkRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`, {
    headers: ghHeaders(env)
  });
  if (checkRes.ok) sha = (await checkRes.json()).sha;

  const commitRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: ghHeaders(env),
    body: JSON.stringify({
      message: (sha ? 'Update' : 'Tambah') + ` cerita: ${title}`,
      content,
      branch,
      ...(sha ? { sha } : {})
    })
  });

  if (!commitRes.ok) {
    const err = await commitRes.text();
    return Response.json({ error: 'GitHub API error: ' + err.slice(0, 300) }, { status: 502 });
  }

  return Response.json({ ok: true, file: path, updated: !!sha });
}

// GET /api/stories — daftar semua cerita dari repo
async function handleList(env) {
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';
  if (!env.GITHUB_TOKEN || !repo) {
    return Response.json({ error: 'GITHUB_TOKEN / GITHUB_REPO belum di-set' }, { status: 500 });
  }

  const res = await fetch(`https://api.github.com/repos/${repo}/contents/content?ref=${branch}`, {
    headers: ghHeaders(env)
  });
  if (!res.ok) return Response.json({ error: 'Gagal membaca folder content/ dari GitHub' }, { status: 502 });

  const files = (await res.json()).filter(f => f.name.endsWith('.md'));

  const stories = await Promise.all(files.map(async f => {
    const raw = await fetch(f.download_url);
    const text = await raw.text();
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const meta = {};
    if (m) {
      for (const line of m[1].split(/\r?\n/)) {
        const kv = line.match(/^(\w+):\s*(.*)$/);
        if (kv) meta[kv[1]] = kv[2].trim();
      }
    }
    return {
      slug: f.name.replace(/\.md$/, ''),
      title: meta.title || f.name,
      description: meta.description || '',
      date: meta.date || '',
      timestamp: meta.timestamp || '',
      pinned: meta.pinned === 'true'
    };
  }));

  stories.sort((a, b) =>
    (b.pinned - a.pinned) ||
    (b.date || '').localeCompare(a.date || '') ||
    (b.timestamp || '').localeCompare(a.timestamp || '') ||
    a.title.localeCompare(b.title, 'id')
  );
  return Response.json({ stories });
}

// DELETE /api/post?slug=xxx — hapus cerita
async function handleDelete(request, env) {
  if (!(await requireAuth(request, env))) {
    return Response.json({ error: 'Tidak terautentikasi' }, { status: 401 });
  }

  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return Response.json({ error: 'Slug tidak valid' }, { status: 400 });
  }

  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';
  const path = `content/${slug}.md`;

  const checkRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`, {
    headers: ghHeaders(env)
  });
  if (!checkRes.ok) return Response.json({ error: 'File tidak ditemukan' }, { status: 404 });
  const sha = (await checkRes.json()).sha;

  const delRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'DELETE',
    headers: ghHeaders(env),
    body: JSON.stringify({ message: `Hapus cerita: ${slug}`, sha, branch })
  });

  if (!delRes.ok) {
    const err = await delRes.text();
    return Response.json({ error: 'GitHub API error: ' + err.slice(0, 300) }, { status: 502 });
  }

  return Response.json({ ok: true });
}

// POST /api/pin — toggle pinned (ubah frontmatter file)
async function handlePin(request, env) {
  if (!(await requireAuth(request, env))) {
    return Response.json({ error: 'Tidak terautentikasi' }, { status: 401 });
  }

  const { slug, pinned } = await request.json();
  if (!slug || !/^[a-z0-9-]+$/.test(slug) || typeof pinned !== 'boolean') {
    return Response.json({ error: 'Parameter tidak valid' }, { status: 400 });
  }

  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';
  const path = `content/${slug}.md`;

  const checkRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`, {
    headers: ghHeaders(env)
  });
  if (!checkRes.ok) return Response.json({ error: 'File tidak ditemukan' }, { status: 404 });
  const fileData = await checkRes.json();
  const text = decodeB64(fileData.content);

  let newText;
  if (pinned) {
    if (/^pinned:/m.test(text)) {
      newText = text.replace(/^pinned:.*$/m, 'pinned: true');
    } else {
      // Sisipkan sebelum penutup frontmatter (baris --- kedua)
      const first = text.indexOf('---');
      const second = text.indexOf('---', first + 3);
      if (second === -1) {
        return Response.json({ error: 'Frontmatter tidak ditemukan di file' }, { status: 400 });
      }
      newText = text.slice(0, second) + 'pinned: true\n' + text.slice(second);
    }
  } else {
    newText = text.replace(/^pinned:.*\r?\n?/m, '');
  }

  const commitRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: ghHeaders(env),
    body: JSON.stringify({
      message: (pinned ? 'Pin' : 'Unpin') + ` cerita: ${slug}`,
      content: encodeB64(newText),
      sha: fileData.sha,
      branch
    })
  });

  if (!commitRes.ok) {
    const err = await commitRes.text();
    return Response.json({ error: 'GitHub API error: ' + err.slice(0, 300) }, { status: 502 });
  }

  return Response.json({ ok: true, pinned });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/login' && request.method === 'POST') return handleLogin(request, env);
    if (path === '/api/stories' && request.method === 'GET') return handleList(env);
    if (path === '/api/post' && request.method === 'POST') return handlePost(request, env);
    if (path === '/api/post' && request.method === 'DELETE') return handleDelete(request, env);
    if (path === '/api/pin' && request.method === 'POST') return handlePin(request, env);

    // Sisanya: file statis dari dist/ (index, cerita, admin, 404, feed)
    return env.ASSETS.fetch(request);
  }
};
