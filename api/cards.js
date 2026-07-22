// Vercel Serverless Function — เก็บ/อ่านข้อมูลการ์ดบนเซิร์ฟเวอร์กลาง (Vercel Blob)
// GET  /api/cards   -> { cards: [...] }                         (ต้องมีรหัสผ่าน)
// POST /api/cards   -> { ok, count, cards }                     (ต้องมีรหัสผ่าน)
//
// ตรรกะรวมทีละใบ (merge) + tombstone + โหมด replace อยู่ใน lib/store.js
// ใช้ร่วมกับ ตู้จุ่ม/พรีออเดอร์/ร้านค้า เพื่อให้พฤติกรรมกันข้อมูลหายเหมือนกันทุกชุด
//
// ความปลอดภัย: ต้องส่ง id + รหัสผ่านใน header x-app-id / x-app-pass (ตรวจผ่าน lib/users)
// ข้อมูลเก็บใน Vercel Blob ผ่าน BLOB_READ_WRITE_TOKEN (ฝั่งเซิร์ฟเวอร์เท่านั้น)

import { handleStore, mergeItems } from '../lib/store.js';

// ชื่อเดิมที่เคยใช้ในเทสต์/สคริปต์ — คงไว้ให้เรียกได้เหมือนเดิม
export const mergeCards = (existing, incoming, prevTombs, incomingDel, now) => {
  const r = mergeItems(existing, incoming, prevTombs, incomingDel, now);
  return { cards: r.items, tombstones: r.tombstones };
};

export default function handler(req, res) {
  return handleStore(req, res, { path: 'cards.json', key: 'cards' });
}
