// lib/store.js — คลังข้อมูลกลางบน Vercel Blob แบบ "รวมทีละรายการ" (per-item merge)
//
// ใช้ร่วมกันทุกชุดข้อมูล (การ์ด / ตู้จุ่ม / พรีออเดอร์ / ร้านค้า) เพื่อกันเคสคลาสสิก
// "แก้คนละเครื่องพร้อมกันแล้วเขียนทับกันจนของหาย"
//
// POST รองรับ 2 โหมด:
//   1) MERGE (ปกติ)  body = { items:[...], deletions:[{id,at}] }  หรือ [...] (client เก่า)
//      → union ตาม id, ใบไหน updatedAt ใหม่กว่าใช้ใบนั้น, ไม่ลบรายการที่ payload ไม่มี
//      → การลบใช้ tombstone (<name>-tombstones.json) กันของที่ลบแล้วฟื้นข้ามเครื่อง
//   2) REPLACE (ตั้งใจแทนที่ทั้งหมด)  body = { items:[...], replace:true }
//      → เขียนทับทั้งไฟล์ + ล้าง tombstone (ใช้กับ ล้างข้อมูล / นำเข้าแบบแทนที่ / อัปโหลดทับ)

import { put, list } from '@vercel/blob';
import { verify } from './users.js';

export const TOMB_KEEP_MS = 60 * 24 * 60 * 60 * 1000; // เก็บ tombstone 60 วันแล้วล้างทิ้ง

const num = (v) => Number(v) || 0;

// อ่าน JSON array จาก Blob (ไม่มี/พังก็คืน [])
export async function readJsonArray(path, opts) {
  try {
    const { blobs } = await list({ prefix: path, ...opts });
    const b = blobs.find((x) => x.pathname === path);
    if (!b) return [];
    // ต้องได้ก้อนล่าสุดจริง ๆ — ทั้ง query กันแคช + header no-cache
    // (ถ้าได้ก้อนเก่าจาก CDN ค่าที่เพิ่งบันทึกจะ "เด้งกลับ" เป็นค่าเดิมจนกว่าแคชจะหมดอายุ)
    const r = await fetch(b.url + '?t=' + Date.now() + '-' + Math.random().toString(36).slice(2), {
      cache: 'no-store',
      headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
    });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch (_) { return []; }
}

export async function writeJson(path, data, opts) {
  await put(path, JSON.stringify(data), {
    access: 'public', contentType: 'application/json',
    addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0, ...opts,
  });
}

// รวมทีละรายการ: union ตาม id, ใบไหน updatedAt ใหม่กว่าใช้ใบนั้น, แล้วค่อยลบตาม tombstone
export function mergeItems(existing, incoming, prevTombs, incomingDel, now) {
  const map = new Map();
  for (const c of existing) if (c && c.id != null) map.set(c.id, c);
  for (const c of incoming) {
    if (!c || c.id == null) continue;
    const prev = map.get(c.id);
    // รายการใหม่ (ยังไม่มี) หรือ updatedAt ใหม่กว่า/เท่ากัน → ใช้ตัวที่เข้ามา
    if (!prev || num(c.updatedAt) >= num(prev.updatedAt)) map.set(c.id, c);
  }

  // รวม tombstone (การลบ) — เก็บเวลาที่ลบล่าสุดของแต่ละ id
  const tomb = new Map();
  for (const t of prevTombs) if (t && t.id != null) tomb.set(t.id, num(t.at));
  for (const t of (incomingDel || [])) {
    if (!t || t.id == null) continue;
    const at = num(t.at) || now;
    if (!tomb.has(t.id) || at > tomb.get(t.id)) tomb.set(t.id, at);
  }

  // ใช้ tombstone: ลบรายการที่ถูกลบ "หลังหรือพร้อม" การแก้ล่าสุด (ถ้าแก้หลังลบ = ฟื้น ให้คงไว้)
  for (const [id, at] of tomb) {
    const c = map.get(id);
    if (c && at >= num(c.updatedAt)) map.delete(id);
  }

  // เก็บ tombstone เท่าที่จำเป็น: ตัดที่เก่าเกิน 60 วัน และตัดของรายการที่ฟื้นแล้ว
  const tombOut = [];
  for (const [id, at] of tomb) {
    if (now - at > TOMB_KEEP_MS) continue;
    const c = map.get(id);
    if (c && num(c.updatedAt) > at) continue; // ถูกแก้หลังลบ = ฟื้น ไม่ต้องเก็บ tombstone
    tombOut.push({ id, at });
  }

  return { items: [...map.values()], tombstones: tombOut };
}

// ตัวจัดการ request มาตรฐานของทุกชุดข้อมูล
//   path    = ชื่อไฟล์บน Blob เช่น 'gacha.json'
//   key     = ชื่อฟิลด์ใน response เช่น 'boxes' (ให้เข้ากับ client เดิม)
export async function handleStore(req, res, { path, key }) {
  const TOMB_PATH = path.replace(/\.json$/, '') + '-tombstones.json';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-id, x-app-pass');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  if (!process.env.APP_PASSCODE) { res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า APP_PASSCODE' }); return; }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const opts = token ? { token } : {};

  // ตรวจ id + รหัสผ่าน (แอดมิน หรือ ผู้ช่วยที่สร้างไว้)
  const id = req.headers['x-app-id'] || '';
  const pass = req.headers['x-app-pass'] || req.query.pass || '';
  const auth = await verify(id, pass, opts);
  if (!auth.ok) { res.status(401).json({ error: 'ID หรือรหัสผ่านไม่ถูกต้อง' }); return; }

  try {
    if (req.method === 'GET') {
      const items = await readJsonArray(path, opts);
      res.status(200).json({ [key]: items });
      return;
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body || '[]');

      // รองรับทั้งแบบเก่า (array ล้วน) และแบบใหม่ ({items|<key>, deletions, replace})
      const isWrapped = body && !Array.isArray(body) && typeof body === 'object';
      const incoming = isWrapped ? (body.items || body[key]) : body;
      const deletions = isWrapped ? (body.deletions || []) : [];
      const replace = isWrapped ? body.replace === true : false;
      if (!Array.isArray(incoming)) { res.status(400).json({ error: 'ข้อมูลต้องเป็น array' }); return; }

      const now = Date.now();

      if (replace) {
        // ตั้งใจแทนที่ทั้งหมด — เขียนทับ + ล้าง tombstone
        await writeJson(path, incoming, opts);
        await writeJson(TOMB_PATH, [], opts);
        res.status(200).json({ ok: true, count: incoming.length, [key]: incoming });
        return;
      }

      // MERGE: โหลดของเดิม + tombstone เดิม แล้วรวมทีละรายการ
      const [existing, prevTombs] = await Promise.all([
        readJsonArray(path, opts),
        readJsonArray(TOMB_PATH, opts),
      ]);
      const merged = mergeItems(existing, incoming, prevTombs, deletions, now);
      await Promise.all([
        writeJson(path, merged.items, opts),
        writeJson(TOMB_PATH, merged.tombstones, opts),
      ]);
      res.status(200).json({ ok: true, count: merged.items.length, [key]: merged.items });
      return;
    }

    res.status(405).json({ error: 'method ไม่รองรับ' });
  } catch (err) {
    res.status(500).json({ error: 'เซิร์ฟเวอร์ผิดพลาด: ' + (err.message || err) });
  }
}
