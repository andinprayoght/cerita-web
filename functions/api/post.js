// POST /api/post — commit file .md cerita baru ke repo GitHub
// Env vars yang dibutuhkan (di-set di Cloudflare Pages dashboard):
//   ADMIN_PASSWORD, ADMIN_SECRET, GITHUB_TOKEN, GITHUB_REPO (mis. "user/repo"), GITHUB_BRANCH (opsional, default main)

async function verifyToken(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return false;
  const data = new TextEncoder().encode((env.ADMIN_PASSWORD || '') + ':' + (env.ADMIN_SECRET || 'salt'));
  const digest = await crypto.subtle.digest('SHA-256', data);
  const expected = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  return token === expected;
}

function slugify(title) {
  return title.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!(await verifyToken(request, env))) {
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
    return Response.json({ error: 'GITHUB_TOKEN / GITHUB_REPO belum di-set di environment Pages' }, { status: 500 });
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

  // Cek apakah file sudah ada (untuk sha, agar bisa update)
  let sha = undefined;
  const checkRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`, {
    headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'User-Agent': 'cerita-web-admin' }
  });
  if (checkRes.ok) {
    sha = (await checkRes.json()).sha;
  }

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
