// Vercel Serverless Function — เก็บ/อ่านข้อมูลการ์ดบนเซิร์ฟเวอร์กลาง (Vercel Blob)
// GET  /api/cards   -> { cards: [...] }                         (ต้องมีรหัสผ่าน)
// POST /api/cards   -> { ok, count, cards }                     (ต้องมีรหัสผ่าน)
//
// POST รองรับ 2 โหมด:
//   1) MERGE (ปกติ) body = { cards:[...], deletions:[{id,at}] }  หรือ [...] (เก่า)
//      → รวมทีละใบตาม id + updatedAt (ตัวใหม่ชนะ) + union (ไม่ลบใบที่ payload ไม่มี)
//        กันเคส "แก้คนละเครื่องพร้อมกันแล้วทับกันจนหาย"
//      → การลบใช้ tombstone (cards-tombstones.json) เพื่อให้ลบแล้วไม่ฟื้นข้ามเครื่อง
//   2) REPLACE (ตั้งใจแทนที่ทั้งหมด) body = { cards:[...], replace:true }
//      → เขียนทับทั้งไฟล์ + ล้าง tombstone (ใช้กับ ล้างข้อมูล/นำเข้าแบบแทนที่/อัปโหลดทับ)
//
// ความปลอดภัย: ต้องส่ง id + รหัสผ่านใน header x-app-id / x-app-pass (ตรวจผ่าน lib/users)
// ข้อมูลเก็บใน Vercel Blob ผ่าน BLOB_READ_WRITE_TOKEN (ฝั่งเซิร์ฟเวอร์เท่านั้น)

import { put, list } from '@vercel/blob';
import { verify } from '../lib/users.js';

const PATH = 'cards.json';
const TOMB_PATH = 'cards-tombstones.json';
const TOMB_KEEP_MS = 60 * 24 * 60 * 60 * 1000; // เก็บ tombstone 60 วันแล้วล้างทิ้ง

const num = (v) => Number(v) || 0;

// อ่าน JSON array จาก Blob (ไม่มี/พังก็คืน [])
async function readJsonArray(path, opts) {
  try {
    const { blobs } = await list({ prefix: path, ...opts });
    const b = blobs.find((x) => x.pathname === path);
    if (!b) return [];
    const r = await fetch(b.url + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch (_) { return []; }
}
async function writeJson(path, data, opts) {
  await put(path, JSON.stringify(data), {
    access: 'public', contentType: 'application/json',
    addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0, ...opts,
  });
}

// รวมทีละใบ: union ตาม id, ใบไหน updatedAt ใหม่กว่าใช้ใบนั้น, แล้วค่อยลบตาม tombstone
export function mergeCards(existing, incoming, prevTombs, incomingDel, now) {
  const map = new Map();
  for (const c of existing) if (c && c.id != null) map.set(c.id, c);
  for (const c of incoming) {
    if (!c || c.id == null) continue;
    const prev = map.get(c.id);
    // ใบใหม่ (ยังไม่มี) หรือ updatedAt ใหม่กว่า/เท่ากัน → ใช้ตัวที่เข้ามา
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

  // ใช้ tombstone: ลบใบที่ถูกลบ "หลังหรือพร้อม" การแก้ล่าสุด (ถ้าแก้หลังลบ = ฟื้น ให้คงไว้)
  for (const [id, at] of tomb) {
    const c = map.get(id);
    if (c && at >= num(c.updatedAt)) map.delete(id);
  }

  // เก็บ tombstone เท่าที่จำเป็น: ตัดที่เก่าเกิน 60 วัน และตัดของใบที่ฟื้นแล้ว
  const tombOut = [];
  for (const [id, at] of tomb) {
    if (now - at > TOMB_KEEP_MS) continue;
    const c = map.get(id);
    if (c && num(c.updatedAt) > at) continue; // ใบนี้ถูกแก้หลังลบ = ฟื้น ไม่ต้องเก็บ tombstone
    tombOut.push({ id, at });
  }

  return { cards: [...map.values()], tombstones: tombOut };
}

export default async function handler(req, res) {
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
      const cards = await readJsonArray(PATH, opts);
      res.status(200).json({ cards });
      return;
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body || '[]');

      // รองรับทั้งแบบเก่า (array) และแบบใหม่ ({cards, deletions, replace})
      const isWrapped = body && !Array.isArray(body) && typeof body === 'object';
      const incoming = isWrapped ? body.cards : body;
      const deletions = isWrapped ? (body.deletions || []) : [];
      const replace = isWrapped ? body.replace === true : false;
      if (!Array.isArray(incoming)) { res.status(400).json({ error: 'ข้อมูลต้องเป็น array' }); return; }

      const now = Date.now();

      if (replace) {
        // ตั้งใจแทนที่ทั้งหมด — เขียนทับ + ล้าง tombstone
        await writeJson(PATH, incoming, opts);
        await writeJson(TOMB_PATH, [], opts);
        res.status(200).json({ ok: true, count: incoming.length, cards: incoming });
        return;
      }

      // MERGE: โหลดของเดิม + tombstone เดิม แล้วรวมทีละใบ
      const [existing, prevTombs] = await Promise.all([
        readJsonArray(PATH, opts),
        readJsonArray(TOMB_PATH, opts),
      ]);
      const merged = mergeCards(existing, incoming, prevTombs, deletions, now);
      await Promise.all([
        writeJson(PATH, merged.cards, opts),
        writeJson(TOMB_PATH, merged.tombstones, opts),
      ]);
      res.status(200).json({ ok: true, count: merged.cards.length, cards: merged.cards });
      return;
    }

    res.status(405).json({ error: 'method ไม่รองรับ' });
  } catch (err) {
    res.status(500).json({ error: 'เซิร์ฟเวอร์ผิดพลาด: ' + (err.message || err) });
  }
}
