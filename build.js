// Build script: baca semua .md di content/, hasilkan situs statis di dist/
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CONTENT_DIR = path.join(ROOT, 'content');
const DIST_DIR = path.join(ROOT, 'dist');
const TEMPLATE_DIR = path.join(ROOT, 'templates');
// Ganti dengan domain asli setelah custom domain dipasang
const SITE_URL = 'https://cerita-web.tipiku.workers.dev';

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  return { meta, body: match[2] };
}
// Markdown -> HTML sederhana (heading, bold, italic, paragraf)
// Aturan paragraf: tiap baris = satu paragraf (copas-friendly).
// Baris kosong hanya pemisah; baris berurutan TIDAK digabung.
function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    // Pemisah adegan: ---, ***, atau ___
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      out.push('<hr>');
      continue;
    }
    const h = t.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
    } else {
      out.push('<p>' + inline(t) + '</p>');
    }
  }
  return out.join('\n');
}

function inline(s) {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function slugify(name) {
  return name.replace(/\.md$/, '');
}

// Baca semua cerita
const stories = [];
for (const f of fs.readdirSync(CONTENT_DIR)) {
  if (!f.endsWith('.md')) continue;
  const raw = fs.readFileSync(path.join(CONTENT_DIR, f), 'utf8');
  const { meta, body } = parseFrontmatter(raw);
  stories.push({
    slug: slugify(f),
    title: meta.title || slugify(f),
    description: meta.description || '',
    date: meta.date || '1970-01-01',
    // Timestamp opsional (ISO) sebagai tie-breaker jika tanggal sama
    timestamp: meta.timestamp || '',
    pinned: meta.pinned === 'true',
    tags: meta.tags ? meta.tags.replace(/^\[|\]$/g, '').split(',').map(t => t.trim()).filter(Boolean) : [],
    html: mdToHtml(body),
  });
}
// Pinned dulu, lalu tanggal terbaru, lalu timestamp terbaru, lalu judul (stabil)
stories.sort((a, b) =>
  (b.pinned - a.pinned) ||
  b.date.localeCompare(a.date) ||
  (b.timestamp || '').localeCompare(a.timestamp || '') ||
  a.title.localeCompare(b.title, 'id')
);

// Template
const layout = fs.readFileSync(path.join(TEMPLATE_DIR, 'layout.html'), 'utf8');
const css = fs.readFileSync(path.join(TEMPLATE_DIR, 'style.css'), 'utf8');

function renderPage(title, bodyHtml, active = '', opts = {}) {
  const description = opts.description || 'Kumpulan cerita pendek untuk dibaca sambil menunggu hujan reda.';
  const canonical = SITE_URL + (opts.canonical || '/');
  return layout
    .replace(/\{\{TITLE\}\}/g, esc(title))
    .replace(/\{\{DESCRIPTION\}\}/g, esc(description))
    .replace(/\{\{CANONICAL\}\}/g, esc(canonical))
    .replace(/\{\{OG_TYPE\}\}/g, opts.ogType || 'website')
    .replace('{{CSS}}', css)
    .replace('{{ACTIVE_HOME}}', active === 'home' ? 'active' : '')
    .replace('{{ACTIVE_ABOUT}}', active === 'about' ? 'active' : '')
    .replace('{{BODY}}', bodyHtml);
}

function storyCard(s) {
  const tags = s.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('');
  const pin = s.pinned ? '<span class="pin">📌</span>' : '';
  return `
  <article class="card${s.pinned ? ' pinned' : ''}">
    <div class="card-date">${pin} ${esc(s.date)}</div>
    <h2><a href="/cerita/${s.slug}/">${esc(s.title)}</a></h2>
    <p class="excerpt">${esc(s.description)}</p>
    <div class="tags">${tags}</div>
  </article>`;
}

// Bersihkan dist
fs.rmSync(DIST_DIR, { recursive: true, force: true });
fs.mkdirSync(DIST_DIR, { recursive: true });

// ===== Halaman utama dengan paginasi (10 cerita per halaman) =====
const PER_PAGE = 10;
const totalPages = Math.max(1, Math.ceil(stories.length / PER_PAGE));

function paginationHtml(current, total) {
  if (total <= 1) return '';
  const pageUrl = n => n === 1 ? '/' : `/page/${n}/`;
  let items = '';
  // Tombol prev
  if (current > 1) {
    items += `<a class="page-btn" href="${pageUrl(current - 1)}">&larr; Sebelumnya</a>`;
  }
  // Nomor halaman
  for (let n = 1; n <= total; n++) {
    if (total > 7 && n > 2 && n < total - 1 && Math.abs(n - current) > 1) {
      // elipsis sederhana
      if (!items.endsWith('<span class="page-ellipsis">…</span>')) {
        items += '<span class="page-ellipsis">…</span>';
      }
      continue;
    }
    items += `<a class="page-num${n === current ? ' current' : ''}" href="${pageUrl(n)}">${n}</a>`;
  }
  // Tombol next
  if (current < total) {
    items += `<a class="page-btn" href="${pageUrl(current + 1)}">Berikutnya &rarr;</a>`;
  }
  return `<nav class="pagination" aria-label="Navigasi halaman">${items}</nav>`;
}

for (let page = 1; page <= totalPages; page++) {
  const start = (page - 1) * PER_PAGE;
  const slice = stories.slice(start, start + PER_PAGE);
  const cards = slice.map(storyCard).join('\n');
  const homeBody = `
<section class="hero">
  <h1>Kumpulan Cerita</h1>
  <p>Cerita pendek untuk dibaca sambil menunggu hujan reda.</p>
</section>
<div class="story-list">${cards}</div>
${paginationHtml(page, totalPages)}`;
  const pageTitle = page === 1 ? 'Kumpulan Cerita' : `Kumpulan Cerita — Halaman ${page}`;
  const outPath = page === 1
    ? path.join(DIST_DIR, 'index.html')
    : path.join(DIST_DIR, 'page', String(page), 'index.html');
  if (page > 1) fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, renderPage(pageTitle, homeBody, 'home', { canonical: page === 1 ? '/' : `/page/${page}/` }));
}

// Halaman cerita
for (const s of stories) {
  const dir = path.join(DIST_DIR, 'cerita', s.slug);
  fs.mkdirSync(dir, { recursive: true });
  const body = `
<article class="story">
  <div class="story-meta">${esc(s.date)} &middot; ${s.tags.map(t => `<span class="tag">${esc(t)}</span>`).join(' ')}</div>
  <h1>${esc(s.title)}</h1>
  ${s.html}
  <div class="story-nav">
    <a href="/">&larr; Kembali ke daftar cerita</a>
  </div>
</article>`;
  fs.writeFileSync(path.join(dir, 'index.html'), renderPage(s.title, body, '', {
    description: s.description,
    canonical: `/cerita/${s.slug}/`,
    ogType: 'article'
  }));
}

// Halaman tentang
const aboutBody = `
<section class="hero">
  <h1>Tentang</h1>
  <p>Website baca cerita sederhana. Dibangun dengan HTML/CSS murni, di-hosting gratis di Cloudflare Pages, konten dikelola lewat admin panel dan disimpan sebagai Markdown di GitHub.</p>
</section>`;
fs.mkdirSync(path.join(DIST_DIR, 'tentang'), { recursive: true });
fs.writeFileSync(path.join(DIST_DIR, 'tentang', 'index.html'), renderPage('Tentang', aboutBody, 'about'));

// 404
fs.writeFileSync(path.join(DIST_DIR, '404.html'), renderPage('Tidak Ditemukan', `
<section class="hero"><h1>404</h1><p>Halaman tidak ditemukan. <a href="/">Kembali ke beranda</a>.</p></section>`));

// Salin file statis dari public/ (mis. admin panel)
const PUBLIC_DIR = path.join(ROOT, 'public');
if (fs.existsSync(PUBLIC_DIR)) {
  for (const f of fs.readdirSync(PUBLIC_DIR)) {
    const src = path.join(PUBLIC_DIR, f);
    if (!fs.statSync(src).isFile()) continue;
    // admin.html -> admin/index.html agar bisa diakses di /admin/
    if (f === 'admin.html') {
      const dir = path.join(DIST_DIR, 'admin');
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(src, path.join(dir, 'index.html'));
    } else {
      fs.copyFileSync(src, path.join(DIST_DIR, f));
    }
  }
}

// RSS
const rssItems = stories.slice(0, 20).map(s => `
  <item>
    <title>${esc(s.title)}</title>
    <link>${SITE_URL}/cerita/${s.slug}/</link>
    <guid>${SITE_URL}/cerita/${s.slug}/</guid>
    <pubDate>${new Date(s.date).toUTCString()}</pubDate>
    <description>${esc(s.description)}</description>
  </item>`).join('');
fs.writeFileSync(path.join(DIST_DIR, 'feed.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Kumpulan Cerita</title>
<link>${SITE_URL}/</link>
<description>Cerita pendek</description>${rssItems}
</channel></rss>`);

// ===== Halaman statis dari content-pages/ (privasi, disclaimer, kontak, dll.) =====
const PAGES_DIR = path.join(ROOT, 'content-pages');
const staticPages = [];
if (fs.existsSync(PAGES_DIR)) {
  for (const f of fs.readdirSync(PAGES_DIR)) {
    if (!f.endsWith('.md')) continue;
    const raw = fs.readFileSync(path.join(PAGES_DIR, f), 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    const slug = slugify(f);
    staticPages.push({ slug, title: meta.title || slug, html: mdToHtml(body) });
  }
  for (const p of staticPages) {
    const dir = path.join(DIST_DIR, 'halaman', p.slug);
    fs.mkdirSync(dir, { recursive: true });
    const body = `
<article class="story">
  <h1>${esc(p.title)}</h1>
  ${p.html}
  <div class="story-nav">
    <a href="/">&larr; Kembali ke beranda</a>
  </div>
</article>`;
    fs.writeFileSync(path.join(dir, 'index.html'), renderPage(p.title, body, '', {
      description: `Halaman ${p.title} — Kumpulan Cerita`,
      canonical: `/halaman/${p.slug}/`
    }));
  }
}

// ===== Sitemap =====
const paginationUrls = [];
for (let p = 2; p <= totalPages; p++) {
  paginationUrls.push({ loc: `/page/${p}/`, priority: '0.6' });
}
const allUrls = [
  { loc: '/', priority: '1.0' },
  ...paginationUrls,
  { loc: '/tentang/', priority: '0.5' },
  ...staticPages.map(p => ({ loc: `/halaman/${p.slug}/`, priority: '0.3' })),
  ...stories.map(s => ({ loc: `/cerita/${s.slug}/`, priority: '0.8', lastmod: s.date })),
];
const sitemapEntries = allUrls.map(u => `
  <url>
    <loc>${SITE_URL}${u.loc}</loc>
    ${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}
    <priority>${u.priority}</priority>
  </url>`).join('');
fs.writeFileSync(path.join(DIST_DIR, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemapEntries}
</urlset>`);

// ===== Robots.txt =====
fs.writeFileSync(path.join(DIST_DIR, 'robots.txt'), `User-agent: *
Allow: /
Disallow: /admin/

Sitemap: ${SITE_URL}/sitemap.xml
`);

console.log(`Build selesai: ${stories.length} cerita, ${staticPages.length} halaman statis -> dist/`);
