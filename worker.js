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

// POST /api/login
async function handleLogin(request, env) {
  const { password } = await request.json();
  if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
    return Response.json({ error: 'Password salah' }, { status: 401 });
  }
  return Response.json({ token: await makeToken(env.ADMIN_PASSWORD, env) });
}

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

// POST /api/post — commit file .md cerita ke repo GitHub
async function handlePost(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  const expected = await makeToken(env.ADMIN_PASSWORD || '', env);
  if (!token || token !== expected) {
    return Response.json({ error: 'Tidak terautentikasi' }, { status: 401 });
  }

  const { title, date, tags, description, body } = await request.json();
  if (!title || !date || !body) {
    return Response.json({ error: 'Judul, tanggal, dan isi wajib diisi' }, { status: 400 });
  }

  const GITHUB_TOKEN = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';
  if (!GITHUB_TOKEN || !repo) {
    return Response.json({ error: 'GITHUB_TOKEN / GITHUB_REPO belum di-set di environment' }, { status: 500 });
  }

  const slug = slugify(title);
  const tagList = (tags || '').split(',').map(t => t.trim()).filter(Boolean);
  const frontmatter = [
    '---',
    `title: ${esc(title)}`,
    `description: ${esc(description || '')}`,
    `date: ${date}`,
    `tags: [${tagList.join(', ')}]`,
    '---',
    ''
  ].join('\n');

  const content = btoa(unescape(encodeURIComponent(frontmatter + body)));
  const path = `content/${slug}.md`;

  // Cek apakah file sudah ada (butuh sha untuk update)
  let sha = undefined;
  const checkRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`, {
    headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'User-Agent': 'cerita-web-admin' }
  });
  if (checkRes.ok) sha = (await checkRes.json()).sha;

  const commitRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'User-Agent': 'cerita-web-admin',
      'Content-Type': 'application/json'
    },
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/login' && request.method === 'POST') return handleLogin(request, env);
    if (url.pathname === '/api/post' && request.method === 'POST') return handlePost(request, env);
    // Sisanya: file statis dari dist/ (index, cerita, admin, 404, feed)
    return env.ASSETS.fetch(request);
  }
};
