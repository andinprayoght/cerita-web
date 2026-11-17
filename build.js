// Build script: baca semua .md di content/, hasilkan situs statis di dist/
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CONTENT_DIR = path.join(ROOT, 'content');
const DIST_DIR = path.join(ROOT, 'dist');
const TEMPLATE_DIR = path.join(ROOT, 'templates');

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
function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let para = [];
  const flush = () => {
    if (para.length) {
      out.push('<p>' + inline(para.join(' ')) + '</p>');
      para = [];
    }
  };
  for (const line of lines) {
    const t = line.trim();
    if (!t) { flush(); continue; }
    const h = t.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flush();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
    } else {
      para.push(t);
    }
  }
  flush();
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
    tags: meta.tags ? meta.tags.replace(/^\[|\]$/g, '').split(',').map(t => t.trim()).filter(Boolean) : [],
    html: mdToHtml(body),
  });
}
stories.sort((a, b) => b.date.localeCompare(a.date));

// Template
const layout = fs.readFileSync(path.join(TEMPLATE_DIR, 'layout.html'), 'utf8');
const css = fs.readFileSync(path.join(TEMPLATE_DIR, 'style.css'), 'utf8');

function renderPage(title, bodyHtml, active = '') {
  return layout
    .replace('{{TITLE}}', esc(title))
    .replace('{{CSS}}', css)
    .replace('{{ACTIVE_HOME}}', active === 'home' ? 'active' : '')
    .replace('{{ACTIVE_ABOUT}}', active === 'about' ? 'active' : '')
    .replace('{{BODY}}', bodyHtml);
}

function storyCard(s) {
  const tags = s.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('');
  return `
  <article class="card">
    <div class="card-date">${esc(s.date)}</div>
    <h2><a href="/cerita/${s.slug}/">${esc(s.title)}</a></h2>
    <p class="excerpt">${esc(s.description)}</p>
    <div class="tags">${tags}</div>
  </article>`;
}

// Bersihkan dist
fs.rmSync(DIST_DIR, { recursive: true, force: true });
fs.mkdirSync(DIST_DIR, { recursive: true });

// Halaman utama
const cards = stories.map(storyCard).join('\n');
const homeBody = `
<section class="hero">
  <h1>Kumpulan Cerita</h1>
  <p>Cerita pendek untuk dibaca sambil menunggu hujan reda.</p>
</section>
<div class="story-list">${cards}</div>`;
fs.writeFileSync(path.join(DIST_DIR, 'index.html'), renderPage('Kumpulan Cerita', homeBody, 'home'));

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
  fs.writeFileSync(path.join(dir, 'index.html'), renderPage(s.title, body));
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
    <link>https://EXAMPLE.pages.dev/cerita/${s.slug}/</link>
    <guid>https://EXAMPLE.pages.dev/cerita/${s.slug}/</guid>
    <pubDate>${new Date(s.date).toUTCString()}</pubDate>
    <description>${esc(s.description)}</description>
  </item>`).join('');
fs.writeFileSync(path.join(DIST_DIR, 'feed.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Kumpulan Cerita</title>
<link>https://EXAMPLE.pages.dev/</link>
<description>Cerita pendek</description>${rssItems}
</channel></rss>`);

console.log(`Build selesai: ${stories.length} cerita -> dist/`);
