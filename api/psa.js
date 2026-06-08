// Vercel Serverless Function — ตัวกลางเรียก PSA Public API
// เก็บ token ไว้ฝั่งเซิร์ฟเวอร์ (process.env.PSA_TOKEN) ไม่หลุดไปฝั่งเบราว์เซอร์
//
// เรียกใช้:  /api/psa?cert=12345678
// คืนค่า:    { found, cert, year, brand, subject, cardNumber, grade, category, variety, frontImage, backImage }

const PSA_BASE = 'https://api.psacard.com/publicapi';

// แคชระดับโมดูล (lambda ใช้ซ้ำข้ามรีเควสต์) — กันเรียก cert เดิมซ้ำจน PSA จำกัดโควต้า (429)
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 ชั่วโมง
const certCache = {}; // cert -> { at, data }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// เรียก PSA พร้อม retry เมื่อโดน rate limit (429) — เคารพ Retry-After ถ้ามี
async function psaFetch(url, headers, tries = 3) {
  let resp;
  for (let i = 0; i < tries; i++) {
    resp = await fetch(url, { headers });
    if (resp.status !== 429) return resp;
    if (i === tries - 1) break; // ครั้งสุดท้ายแล้ว — คืน 429 ออกไป
    const ra = parseFloat(resp.headers.get('retry-after'));
    const waitMs = Number.isFinite(ra) ? Math.min(ra * 1000, 8000) : 800 * Math.pow(2, i); // 0.8s, 1.6s, ...
    await sleep(waitMs);
  }
  return resp;
}

export default async function handler(req, res) {
  // CORS — อนุญาตให้หน้าเว็บ (GitHub Pages / Vercel / เปิดไฟล์ตรงๆ) เรียกได้
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

  // ตอบจากแคชถ้ามี (ลดจำนวนคำขอไป PSA)
  const cached = certCache[cert];
  if (cached && (Date.now() - cached.at) < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
    res.status(200).json(cached.data);
    return;
  }

  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  try {
    // 1) ข้อมูลการ์ด
    const certResp = await psaFetch(`${PSA_BASE}/cert/GetByCertNumber/${cert}`, headers);
    if (certResp.status === 401 || certResp.status === 403) {
      res.status(502).json({ error: 'token PSA ไม่ถูกต้องหรือหมดสิทธิ์' });
      return;
    }
    if (certResp.status === 429) {
      const ra = parseFloat(certResp.headers.get('retry-after'));
      res.setHeader('Retry-After', Number.isFinite(ra) ? String(Math.ceil(ra)) : '30');
      res.status(429).json({ error: 'PSA จำกัดจำนวนคำขอชั่วคราว (429) — รอสักครู่แล้วลองใหม่' });
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

    // 2) รูปการ์ด (อาจไม่มีในบางใบ) — 429 ตรงนี้ไม่ทำให้ทั้งคำขอล้ม
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
    certCache[cert] = { at: Date.now(), data: payload }; // เก็บแคชไว้กันเรียกซ้ำ
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
    res.status(200).json(payload);
  } catch (err) {
    res.status(500).json({ error: 'เรียก PSA ไม่สำเร็จ: ' + (err.message || err) });
  }
}
