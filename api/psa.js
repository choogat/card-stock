// Vercel Serverless Function — ดึงข้อมูล cert จากหน้าเว็บสาธารณะของ PSA
//
// ⚠️ PSA ยกเลิก free public API (api.psacard.com/publicapi) แล้ว (แจ้ง ก.ค. 2026)
//    จึงเปลี่ยนมา "อ่าน" หน้า cert สาธารณะ https://www.psacard.com/cert/<cert> แทน
//    ข้อดี: ไม่ต้องใช้ token, ไม่มีโควต้า/429 แบบเดิม, ได้ทั้งข้อมูลการ์ด + รูปหน้า/หลัง
//
// เรียกใช้:  /api/psa?cert=12345678
// คืนค่า:    { found, cert, year, brand, subject, cardNumber, category, variety,
//              grade, gradeNumber, labelType, frontImage, backImage, imgChecked }
//   (โครงสร้างเดิม — ฝั่งเว็บไม่ต้องแก้)
//
// แคชถาวรบน Vercel Blob (psa-cache/<cert>.json) — cert ที่เคยอ่านแล้วจะไม่ไปดึงซ้ำ
// (เร็วขึ้น + สุภาพกับเซิร์ฟเวอร์ PSA)

import { put, list } from '@vercel/blob';

const CERT_BASE = 'https://www.psacard.com/cert/';
const CACHE_PREFIX = 'psa-cache/';
const MEM_TTL_MS = 6 * 60 * 60 * 1000; // 6 ชั่วโมง
const memCache = {}; // cert -> { at, data }

const blobOpts = () => { const t = process.env.BLOB_READ_WRITE_TOKEN; return t ? { token: t } : {}; };

// headers แบบเบราว์เซอร์ Chrome จริง ลดโอกาสโดน Cloudflare bot-protection บล็อก
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
  'Cookie': 'psa-locale=en-US; env=prod',
};

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
    // ยิง URL สุดท้ายตรง ๆ (/cert/<n>/psa) เลี่ยง redirect 307 ที่ทำ cookie หลุด
    const resp = await fetch(CERT_BASE + cert + '/psa', { headers: BROWSER_HEADERS, redirect: 'follow' });

    if (resp.status === 404) {
      res.status(404).json({ found: false, error: 'ไม่พบเลข cert นี้ในระบบ PSA' });
      return;
    }
    if (!resp.ok) {
      // 403/429/5xx = PSA บล็อก/ขัดข้องชั่วคราว (ไม่ใช่ว่า cert ไม่มี) — ให้ลองใหม่ทีหลัง
      res.setHeader('Cache-Control', 'no-store');
      res.status(502).json({ error: `PSA ตอบกลับผิดพลาด (${resp.status}) — ลองใหม่อีกครั้ง` });
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
