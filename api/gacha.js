// Vercel Serverless Function — เก็บ/อ่านข้อมูล "ตู้จุ่ม" บนเซิร์ฟเวอร์กลาง (Vercel Blob)
// GET  /api/gacha   -> { boxes: [...] }                       (ต้องมีรหัสผ่าน)
// POST /api/gacha   body = { items:[...], deletions:[...] }    (ต้องมีรหัสผ่าน)
//                   -> { ok, count, boxes }
//
// รวมทีละรายการ + tombstone ผ่าน lib/store.js กันของหายเมื่อแก้หลายเครื่อง
// หมายเหตุ: ผู้ใช้ readonly บันทึกได้ (เพื่อให้ติ๊ก "ออกแล้ว" ได้) — การกันแก้ไขตู้อยู่ที่ฝั่งหน้าเว็บ
// ความปลอดภัย: ต้องส่ง id + รหัสผ่านมาใน header x-app-id / x-app-pass (ตรวจผ่าน lib/users.js)

import { handleStore } from '../lib/store.js';

export default function handler(req, res) {
  return handleStore(req, res, { path: 'gacha.json', key: 'boxes' });
}
