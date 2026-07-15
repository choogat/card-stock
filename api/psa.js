// Vercel Serverless Function — ดึงข้อมูล cert จากหน้าเว็บสาธารณะของ PSA
//
// ⚠️ PSA ยกเลิก free public API (api.psacard.com/publicapi) แล้ว (แจ้ง ก.ค. 2026)
//    จึงเปลี่ยนมา "อ่าน" หน้า cert สาธารณะ https://www.psacard.com/cert/<cert>/psa แทน
//    ข้อดี: ไม่ต้องใช้ token, ไม่มีโควต้า/429 แบบเดิม, ได้ทั้งข้อมูลการ์ด + รูปหน้า/หลัง
//
// ⚠️ www.psacard.com อยู่หลัง Cloudflare bot-protection — ยิงตรงจาก IP ของ Vercel
//    จะโดน 403 ทันที จึงต้องผ่าน Jina Reader (r.jina.ai) ที่ทะลุ Cloudflare ให้
//    ฟรี ไม่ต้องคีย์; ใส่ env JINA_API_KEY เพื่อเพิ่มลิมิตได้ (ไม่ใส่ก็ทำงาน)
//
// เรียกใช้:  /api/psa?cert=12345678
// คืนค่า:    { found, cert, year, brand, subject, cardNumber, category, variety,
//              grade, gradeNumber, labelType, frontImage, backImage, imgChecked }
//   (โครงสร้างเดิม — ฝั่งเว็บไม่ต้องแก้)
//
// แคชถาวรบน Vercel Blob (psa-cache/<cert>.json) — cert ที่เคยอ่านแล้วจะไม่ไปดึงซ้ำ
// (เร็วขึ้น + สุภาพกับเซิร์ฟเวอร์ PSA + ประหยัดลิมิต Jina)

import { put, list } from '@vercel/blob';

const CERT_URL = (cert) => `https://www.psacard.com/cert/${cert}/psa`;
const JINA_PREFIX = 'https://r.jina.ai/';
const CACHE_PREFIX = 'psa-cache/';
const MEM_TTL_MS = 6 * 60 * 60 * 1000; // 6 ชั่วโมง
const memCache = {}; // cert -> { at, data }

const blobOpts = () => { const t = process.env.BLOB_READ_WRITE_TOKEN; return t ? { token: t } : {}; };

// ดึงหน้า cert ผ่าน Jina Reader — สั่งให้คืน HTML ดิบ (X-Return-Format: html)
// เพื่อใช้ parser ตัวเดิม (อ่าน dt/dd + รูป full-res จาก originalPath)
function jinaFetch(cert) {
  const headers = {
    'X-Return-Format': 'html',
    'X-Timeout': '30',
    Accept: 'text/html,*/*',
  };
  const key = process.env.JINA_API_KEY;
  if (key) headers.Authorization = `Bearer ${key}`;
  return fetch(JINA_PREFIX + CERT_URL(cert), { headers });
}

// ---------- ตัวแปลง HTML → ข้อมูล cert ----------
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
const stripTags = (s) => decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function parseCertHtml(html, cert) {
  // 1) ตาราง label/ค่า (โครง <dt>ป้าย</dt><dd>ค่า</dd>)
  const fields = {};
  for (const m of html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)) {
    const k = stripTags(m[1]).toLowerCase();
    if (k) fields[k] = stripTags(m[2]);
  }
  const pick = (...needles) => {
    for (const n of needles) {
      const key = Object.keys(fields).find((k) => k.includes(n));
      if (key && fields[key]) return fields[key];
    }
    return '';
  };
  // ต้องมีอย่างน้อยเลข cert หรือเกรด ไม่งั้นถือว่าไม่พบ/หน้าไม่ใช่ cert
  if (!fields['cert number'] && !fields['item grade']) return { found: false };

  const grade = pick('item grade', 'grade');

  // 2) รูป — เอา full-res จาก payload ของหน้า (originalPath), ลำดับ = หน้า, หลัง
  let imgs = [];
  const anchor = html.indexOf('originalPath');
  if (anchor !== -1) {
    const seg = html.slice(Math.max(0, anchor - 4000), anchor + 4000).replace(/\\"/g, '"');
    imgs = [...seg.matchAll(/"originalPath":"([^"]+)"/g)].map((m) => m[1]);
  }
  // สำรอง: <img alt="Cert image N"> ที่ render มาแล้ว (เป็นภาพย่อ)
  if (!imgs.length) {
    imgs = [...html.matchAll(/<img[^>]*alt="Cert image \d+"[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  }

  return {
    found: true,
    cert: pick('cert number') || cert,
    year: pick('year'),
    brand: pick('brand/title', 'brand', 'title'),
    subject: pick('subject'),
    cardNumber: pick('card number'),
    category: pick('category'),
    variety: pick('variety/pedigree', 'variety', 'pedigree'),
    grade,
    gradeNumber: (String(grade).match(/(\d+(\.\d+)?)/) || [''])[0],
    labelType: pick('label type'),
    frontImage: imgs[0] || '',
    backImage: imgs[1] || '',
    imgChecked: true,
  };
}

// ---------- แคช Blob (ล้มเหลวไม่เป็นไร) ----------
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
  // 2) แคชถาวรบน Blob — เคยอ่านครบแล้วไม่ต้องไปดึงหน้าเว็บซ้ำ
  const cachedBlob = await readBlobCache(cert);
  if (cachedBlob && cachedBlob.found) {
    memCache[cert] = { at: Date.now(), data: cachedBlob };
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
    res.status(200).json(cachedBlob);
    return;
  }

  try {
    const resp = await jinaFetch(cert);

    if (!resp.ok) {
      // Jina ขัดข้อง/ชนลิมิต (429/402/5xx) — ไม่ใช่ว่า cert ไม่มี ให้ลองใหม่ทีหลัง
      res.setHeader('Cache-Control', 'no-store');
      const hint = resp.status === 429 ? ' (ดึงถี่เกินไป รอสักครู่)' : '';
      res.status(502).json({ error: `ดึงข้อมูล PSA ไม่สำเร็จ (${resp.status})${hint} — ลองใหม่อีกครั้ง` });
      return;
    }

    const html = await resp.text();
    const payload = parseCertHtml(html, cert);
    if (!payload.found) {
      res.status(404).json({ found: false, error: 'ไม่พบเลข cert นี้ในระบบ PSA' });
      return;
    }

    memCache[cert] = { at: Date.now(), data: payload };
    await writeBlobCache(cert, payload);
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
    res.status(200).json(payload);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ error: 'เรียกข้อมูล PSA ไม่สำเร็จ: ' + (err.message || err) });
  }
}
