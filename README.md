# Kumpulan Cerita

Website baca cerita sederhana — hosting gratis di **Cloudflare Pages**, konten dikelola lewat **admin panel**, tersimpan sebagai **Markdown di GitHub**.

## Cara Kerja

```
Admin Panel (/admin) → Pages Function → Commit .md ke GitHub → Cloudflare Pages rebuild otomatis → Situs update
```

- Cerita = file `.md` di folder `content/` dengan frontmatter (title, description, date, tags)
- `build.js` mengubah semua `.md` menjadi HTML statis di `dist/`
- `functions/` = Cloudflare Pages Functions (login + commit ke GitHub API)

## Menjalankan Lokal

```bash
cd cerita-web
npm run build        # build situs ke dist/
npx wrangler pages dev dist   # preview + functions di http://localhost:8788
```

## Deploy ke Cloudflare Pages

1. **Push folder ini ke repo GitHub** (bisa repo terpisah atau folder di repo ini).

2. **Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git**, pilih repo:
   - **Build command**: `cd cerita-web && node build.js`
   - **Build output directory**: `cerita-web/dist`
   - *(Jika repo isinya hanya folder ini: build command `node build.js`, output `dist`)*

3. **Set environment variables** di Pages → Settings → Environment variables (Production & Preview):

   | Variabel | Isi |
   |---|---|
   | `ADMIN_PASSWORD` | password login admin panel |
   | `ADMIN_SECRET` | string acak untuk token (bebas, mis. UUID) |
   | `GITHUB_TOKEN` | [Personal Access Token](https://github.com/settings/tokens) dengan izin **repo** (Contents: Read & write) |
   | `GITHUB_REPO` | `username/nama-repo` |
   | `GITHUB_BRANCH` | `main` (opsional) |

4. Deploy. Selesai — situs live di `https://nama-project.pages.dev`.

## Posting Cerita

1. Buka `https://situs-kamu.pages.dev/admin/`
2. Login dengan `ADMIN_PASSWORD`
3. Isi judul, tanggal, tag, deskripsi, dan isi cerita
4. Klik **Publish** → file `.md` di-commit ke GitHub → situs rebuild otomatis ±1 menit

## Menulis Cerita Manual

Buat file baru di `content/`, mis. `cerita-saya.md`:

```markdown
---
title: Judul Cerita
description: Ringkasan satu kalimat.
date: 2026-11-17
tags: [romansa, drama]
---

Isi cerita di sini. Mendukung **tebal**, *miring*, dan `# heading` untuk bagian.
```

Commit & push → Cloudflare Pages rebuild otomatis.
