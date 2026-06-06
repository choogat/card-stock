// ตัวช่วยจัดการผู้ใช้ (เก็บใน Vercel Blob: users.json)
// แอดมินหลัก = id 'Cielcard' + รหัส APP_PASSCODE (จาก env) — มีสิทธิ์ทุกแถบ + จัดการผู้ใช้
import { list, put } from '@vercel/blob';

const PATH = 'users.json';
export const ADMIN_ID = 'Cielcard';
export const ALL_TABS = ['stock', 'sales', 'report'];

export async function loadUsers(opts) {
  try {
    const { blobs } = await list({ prefix: PATH, ...opts });
    const b = blobs.find(x => x.pathname === PATH);
    if (!b) return [];
    const r = await fetch(b.url + '?t=' + Date.now(), { cache: 'no-store' });
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } catch (_) { return []; }
}

export async function saveUsers(users, opts) {
  await put(PATH, JSON.stringify(users), {
    access: 'public', contentType: 'application/json',
    addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0, ...opts,
  });
}

// ตรวจสอบ id+รหัส → คืนสิทธิ์
export async function verify(id, pass, opts) {
  if (!id || !pass) return { ok: false };
  if (id === ADMIN_ID && pass === process.env.APP_PASSCODE) {
    return { ok: true, id, role: 'admin', tabs: ALL_TABS };
  }
  const users = await loadUsers(opts);
  const u = users.find(x => x.id === id && x.password === pass);
  if (u) return { ok: true, id: u.id, role: 'assistant', tabs: Array.isArray(u.tabs) ? u.tabs : [] };
  return { ok: false };
}
