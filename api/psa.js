// Vercel Serverless Function — ตัวกลางเรียก PSA Public API
// เก็บ token ไว้ฝั่งเซิร์ฟเวอร์ (process.env.PSA_TOKEN) ไม่หลุดไปฝั่งเบราว์เซอร์
//
// เรียกใช้:  /api/psa?cert=12345678
// คืนค่า:    { found, cert, year, brand, subject, cardNumber, grade, category, variety, frontImage, backImage }
//
// แคช 2 ชั้นกันโดน PSA จำกัดโควต้า (429):
//   1) in-memory ต่อ lambda (เร็วสุด)
//   2) Vercel Blob ถาวร (psa-cache/<cert>.json) — cert ที่เคยดึงแล้วจะไม่เรียก PSA ซ้ำอีกเลย
//
// Token rotation: ใส่ได้หลาย token ผ่าน env — PSA_TOKEN, PSA_TOKEN2, PSA_TOKEN3, ...
//   (หรือ PSA_TOKENS = หลายอันคั่นด้วย comma). พอ token หนึ่งโดนจำกัด (429/401/403)
//   จะสลับไปใช้ตัวถัดไปอัตโนมัติ เพราะโควต้าแยกตาม token. ถ้ามีตัวเดียว ทำงานเหมือนเดิม.

import { put, list } from '@vercel/blob';
import { ProxyAgent } from 'undici';

// ถ้าตั้งค่า PSA_PROXY (เช่น http://user:pass@host:port) จะยิง PSA ผ่าน proxy IP นั้น
// เพื่อเลี่ยง IP รวมของ Vercel ที่โดน PSA แบน — ไม่ตั้งค่า = ยิงตรงเหมือนเดิม
let _psaDispatcher = null;
function psaDispatcher() {
  if (_psaDispatcher !== null) return _psaDispatcher || undefined;
  const url = process.env.PSA_PROXY;
  _psaDispatcher = url ? new ProxyAgent(url) : false;
  return _psaDispatcher || undefined;
}

const PSA_BASE = 'https://api.psacard.com/publicapi';
const CACHE_PREFIX = 'psa-cache/';
const MEM_TTL_MS = 6 * 60 * 60 * 1000; // 6 ชั่วโมง
const memCache = {}; // cert -> { at, data }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const blobOpts = () => { const t = process.env.BLOB_READ_WRITE_TOKEN; return t ? { token: t } : {}; };

// รวบรวม token ทั้งหมดจาก env (PSA_TOKEN, PSA_TOKEN2..PSA_TOKEN10, PSA_TOKENS)
function getTokens() {
  const list = [];
  const push = (v) => { if (v && typeof v === 'string') v.split(',').forEach((t) => { const s = t.trim(); if (s) list.push(s); }); };
  push(process.env.PSA_TOKEN);
  for (let i = 2; i <= 10; i++) push(process.env['PSA_TOKEN' + i]);
  push(process.env.PSA_TOKENS);
  return [...new Set(list)];
}

// เรียก PSA โดยหมุนหลาย token — token ไหนโดนจำกัด (429) หรือใช้ไม่ได้ (401/403) ก็ข้ามไปตัวถัดไป
// ถ้าทุก token โดน 429 จะ backoff ตาม Retry-After แล้วลองใหม่ (เผื่อ 429 ชั่วคราว)
async function psaFetch(url, tokens, tries = 2) {
  let lastResp = null, limited = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    for (const tk of tokens) {
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${tk}`, Accept: 'application/json' }, dispatcher: psaDispatcher() });
      if (resp.status === 429) { limited = resp; lastResp = resp; continue; } // token นี้เต็ม → ลองตัวถัดไป
      if (resp.status === 401 || resp.status === 403) { lastResp = resp; continue; } // token เสีย → ลองตัวถัดไป
      return resp; // สำเร็จ (หรือ error อื่นที่ไม่เกี่ยวกับลิมิต) — ใช้เลย
    }
    // ทุก token รอบนี้ใช้ไม่ได้ — ถ้ายังมีรอบเหลือและมีอย่างน้อยตัวที่ 429 ค่อย backoff แล้วลองใหม่
    if (attempt < tries - 1 && limited) {
      const ra = parseFloat(limited.headers.get('retry-after'));
      await sleep(Number.isFinite(ra) ? Math.min(ra * 1000, 8000) : 800 * Math.pow(2, attempt));
    } else break;
  }
  return limited || lastResp;
}

// อ่าน/เขียนแคชถาวรบน Blob — ล้มเหลวไม่เป็นไร (ค่อยไปเรียก PSA ตรง)
async function readBlobCache(cert) {
  try {
    const path = CACHE_PREFIX + cert + '.json';
    const { blobs } = await list({ prefix: path, ...blobOpts() });
    const b = blobs.find((x) => x.pathname === path);
    if (!b) return null;
    const r = await fetch(b.url + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { return null; }
}
async function writeBlobCache(cert, data) {
  try {
    await put(CACHE_PREFIX + cert + '.json', JSON.stringify(data), {
      access: 'public', contentType: 'application/json',
      addRandomSuffix: false, allowOverwrite: true, ...blobOpts(),
    });
  } catch (_) { /* แคชล้มเหลวไม่เป็นไร */ }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const tokens = getTokens();
  if (!tokens.length) {
    res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า PSA_TOKEN ในเซิร์ฟเวอร์' });
    return;
  }

  const cert = String(req.query.cert || '').trim().replace(/\D/g, '');
  if (!cert) {
    res.status(400).json({ error: 'กรุณาระบุเลข cert (?cert=...)' });
    return;
  }

  // 1) แคช in-memory
  const mc = memCache[cert];
  if (mc && (Date.now() - mc.at) < MEM_TTL_MS) {
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
    res.status(200).json(mc.data);
    return;
  }
  // 2) แคชถาวรบน Blob — ไม่ต้องเรียก PSA เลยถ้าเคยดึงครบแล้ว
  //    "ครบ" = มีรูป หรือ ยืนยันแล้วว่าใบนี้ไม่มีรูปจริง (imgChecked)
  //    ถ้าเป็นแคชเก่าที่ไม่มีรูปเพราะโดน 429 (ไม่มี imgChecked) → ปล่อยให้ดึงรูปใหม่ด้านล่าง
  const cachedBlob = await readBlobCache(cert);
  if (cachedBlob && cachedBlob.found && (cachedBlob.frontImage || cachedBlob.imgChecked)) {
    memCache[cert] = { at: Date.now(), data: cachedBlob };
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
    res.status(200).json(cachedBlob);
    return;
  }

  try {
    // ข้อมูลการ์ด
    const certResp = await psaFetch(`${PSA_BASE}/cert/GetByCertNumber/${cert}`, tokens);
    if (certResp.status === 401 || certResp.status === 403) {
      res.status(502).json({ error: 'token PSA ไม่ถูกต้องหรือหมดสิทธิ์' });
      return;
    }
    if (certResp.status === 429) {
      const ra = parseFloat(certResp.headers.get('retry-after'));
      const mins = Number.isFinite(ra) ? Math.ceil(ra / 60) : 0;
      res.setHeader('Retry-After', Number.isFinite(ra) ? String(Math.ceil(ra)) : '60');
      res.status(429).json({
        error: mins
          ? `โควต้า PSA เต็มชั่วคราว (429) — ลองใหม่ในอีกประมาณ ${mins} นาที`
          : 'โควต้า PSA เต็มชั่วคราว (429) — รอสักครู่แล้วลองใหม่',
        retryAfterSec: Number.isFinite(ra) ? Math.ceil(ra) : null,
      });
      return;
    }
    if (!certResp.ok) {
      res.status(502).json({ error: `PSA ตอบกลับผิดพลาด (${certResp.status})` });
      return;
    }
    const certData = await certResp.json();
    const c = certData && (certData.PSACert || certData.psaCert || certData);
    if (!c || !(c.CertNumber || c.certNumber)) {
      res.status(404).json({ found: false, error: 'ไม่พบเลข cert นี้ในระบบ PSA' });
      return;
    }

    // รูปการ์ด (อาจไม่มีในบางใบ) — 429 ตรงนี้ไม่ทำให้ทั้งคำขอล้ม
    // imgRateLimited = call รูปโดนจำกัดโควต้า (ไม่ใช่ "ไม่มีรูปจริง") → ห้ามแคชถาวร ไม่งั้นใบนี้จะไม่มีรูปตลอดไป
    let frontImage = '', backImage = '', imgRateLimited = false, imgChecked = false;
    try {
      const imgResp = await psaFetch(`${PSA_BASE}/cert/GetImagesByCertNumber/${cert}`, tokens, 1);
      if (imgResp.ok) {
        imgChecked = true; // ถาม PSA เรื่องรูปสำเร็จแล้ว (มีหรือไม่มีรูปก็ถือว่าครบ)
        const imgs = await imgResp.json();
        if (Array.isArray(imgs)) {
          for (const im of imgs) {
            const url = im.ImageURL || im.imageURL || im.imageUrl || '';
            const isFront = im.IsFrontImage ?? im.isFrontImage;
            if (isFront && !frontImage) frontImage = url;
            else if (!isFront && !backImage) backImage = url;
          }
          if (!frontImage && imgs[0]) frontImage = imgs[0].ImageURL || imgs[0].imageURL || '';
        }
      } else if (imgResp.status === 429) {
        imgRateLimited = true; // โควต้ารูปเต็ม — เก็บแคชถาวรไม่ได้ เดี๋ยวรูปหายถาวร
      }
    } catch (_) { /* ไม่มีรูปก็ปล่อยผ่าน */ }

    const grade = c.CardGrade || c.GradeDescription || c.cardGrade || c.gradeDescription || '';
    const payload = {
      found: true,
      cert: c.CertNumber || c.certNumber || cert,
      year: c.Year || c.year || '',
      brand: c.Brand || c.brand || '',
      subject: c.Subject || c.subject || '',
      cardNumber: c.CardNumber || c.cardNumber || '',
      category: c.Category || c.CategoryName || c.category || '',
      variety: c.Variety || c.variety || '',
      grade,
      gradeNumber: (String(grade).match(/(\d+(\.\d+)?)/) || [''])[0],
      frontImage,
      backImage,
      imgChecked, // true = ยืนยันสถานะรูปแล้ว (กันดึงซ้ำกับใบที่ไม่มีรูปจริง)
    };
    // แคชเฉพาะผลที่ "ครบ" — ถ้ารูปโดน 429 (ยังไม่ได้รูปเพราะโควต้าเต็ม) อย่าเก็บถาวร
    // ไม่งั้นใบนี้จะถูกเสิร์ฟแบบไม่มีรูปตลอดไป แม้แบนจะหมดแล้วก็ตาม
    if (!imgRateLimited) {
      memCache[cert] = { at: Date.now(), data: payload };
      await writeBlobCache(cert, payload); // เก็บถาวร กันเรียก PSA ซ้ำในอนาคต
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
    } else {
      res.setHeader('Cache-Control', 'no-store'); // ผลไม่ครบ (ขาดรูป) — ให้ดึงใหม่ทีหลัง
    }
    res.status(200).json(payload);
  } catch (err) {
    res.status(500).json({ error: 'เรียก PSA ไม่สำเร็จ: ' + (err.message || err) });
  }
}
