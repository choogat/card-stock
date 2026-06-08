// Vercel Serverless Function — ตัวกลางเรียก PSA Public API
// เก็บ token ไว้ฝั่งเซิร์ฟเวอร์ (process.env.PSA_TOKEN) ไม่หลุดไปฝั่งเบราว์เซอร์
//
// เรียกใช้:  /api/psa?cert=12345678
// คืนค่า:    { found, cert, year, brand, subject, cardNumber, grade, category, variety, frontImage, backImage }
//
// แคช 2 ชั้นกันโดน PSA จำกัดโควต้า (429):
//   1) in-memory ต่อ lambda (เร็วสุด)
//   2) Vercel Blob ถาวร (psa-cache/<cert>.json) — cert ที่เคยดึงแล้วจะไม่เรียก PSA ซ้ำอีกเลย

import { put, list } from '@vercel/blob';

const PSA_BASE = 'https://api.psacard.com/publicapi';
const CACHE_PREFIX = 'psa-cache/';
const MEM_TTL_MS = 6 * 60 * 60 * 1000; // 6 ชั่วโมง
const memCache = {}; // cert -> { at, data }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const blobOpts = () => { const t = process.env.BLOB_READ_WRITE_TOKEN; return t ? { token: t } : {}; };

// เรียก PSA พร้อม retry เมื่อโดน rate limit (429) — เคารพ Retry-After ถ้ามี
async function psaFetch(url, headers, tries = 3) {
  let resp;
  for (let i = 0; i < tries; i++) {
    resp = await fetch(url, { headers });
    if (resp.status !== 429) return resp;
    if (i === tries - 1) break;
    const ra = parseFloat(resp.headers.get('retry-after'));
    const waitMs = Number.isFinite(ra) ? Math.min(ra * 1000, 8000) : 800 * Math.pow(2, i);
    await sleep(waitMs);
  }
  return resp;
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

  const token = process.env.PSA_TOKEN;
  if (!token) {
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
  // 2) แคชถาวรบน Blob — ไม่ต้องเรียก PSA เลยถ้าเคยดึงแล้ว
  const cachedBlob = await readBlobCache(cert);
  if (cachedBlob && cachedBlob.found) {
    memCache[cert] = { at: Date.now(), data: cachedBlob };
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
    res.status(200).json(cachedBlob);
    return;
  }

  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  try {
    // ข้อมูลการ์ด
    const certResp = await psaFetch(`${PSA_BASE}/cert/GetByCertNumber/${cert}`, headers);
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
    let frontImage = '', backImage = '';
    try {
      const imgResp = await psaFetch(`${PSA_BASE}/cert/GetImagesByCertNumber/${cert}`, headers, 2);
      if (imgResp.ok) {
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
    };
    memCache[cert] = { at: Date.now(), data: payload };
    await writeBlobCache(cert, payload); // เก็บถาวร กันเรียก PSA ซ้ำในอนาคต
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
    res.status(200).json(payload);
  } catch (err) {
    res.status(500).json({ error: 'เรียก PSA ไม่สำเร็จ: ' + (err.message || err) });
  }
}
