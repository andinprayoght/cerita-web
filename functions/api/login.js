// POST /api/login — verifikasi password, kembalikan token sederhana
export async function onRequestPost(context) {
  const { request, env } = context;
  const { password } = await request.json();

  if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
    return Response.json({ error: 'Password salah' }, { status: 401 });
  }

  // Token = hash sederhana dari password + secret. Cukup untuk kasus ini.
  const data = new TextEncoder().encode(password + ':' + (env.ADMIN_SECRET || 'salt'));
  const digest = await crypto.subtle.digest('SHA-256', data);
  const token = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');

  return Response.json({ token });
}
