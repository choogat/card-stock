// Vercel Serverless Function — ตัวกลางเรียก PSA Public API
// เก็บ token ไว้ฝั่งเซิร์ฟเวอร์ (process.env.PSA_TOKEN) ไม่หลุดไปฝั่งเบราว์เซอร์
//
// เรียกใช้:  /api/psa?cert=12345678
// คืนค่า:    { found, cert, year, brand, subject, cardNumber, grade, category, variety, frontImage, backImage }

const PSA_BASE = 'https://api.psacard.com/publicapi';

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

  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  try {
    // 1) ข้อมูลการ์ด
    const certResp = await fetch(`${PSA_BASE}/cert/GetByCertNumber/${cert}`, { headers });
    if (certResp.status === 401 || certResp.status === 403) {
      res.status(502).json({ error: 'token PSA ไม่ถูกต้องหรือหมดสิทธิ์' });
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

    // 2) รูปการ์ด (อาจไม่มีในบางใบ)
    let frontImage = '', backImage = '';
    try {
      const imgResp = await fetch(`${PSA_BASE}/cert/GetImagesByCertNumber/${cert}`, { headers });
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
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
    res.status(200).json({
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
    });
  } catch (err) {
    res.status(500).json({ error: 'เรียก PSA ไม่สำเร็จ: ' + (err.message || err) });
  }
}
