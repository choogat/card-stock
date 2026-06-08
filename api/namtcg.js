// Vercel Serverless Function — ตัวกลางดึงราคา RAW / PSA10 จาก namcardtcg.com
//
// เรียกใช้:  /api/namtcg?code=OP09-119
// คืนค่า:    { found, code, jpyThb, usdThb, updated, variants:[ {key, name, rarity, stock,
//              rawThb, rawJpy, psa10Thb, psa10Jpy, psa10Usd, psa10Fmt, image_url} ] }
//
// namcardtcg เก็บราคาเป็นไฟล์ JSON สถิต:
//   prices_full.json  → ราคา RAW ญี่ปุ่น (ฟิลด์ jpy + thb ที่แปลงแล้ว) คีย์เช่น OP09-119, OP09-119_p2
//   psa_mapping.json  → ราคา PSA10 (psa10_ask_jpy / psa10_ask_usd) คีย์ตัวพิมพ์ใหญ่ เช่น OP09-119_P2
//   exchange_rate.json→ เรตแปลงเงิน (JPY.selling / USD.selling)

const NAM_BASE = 'https://namcardtcg.com';
const FILES = {
  prices: `${NAM_BASE}/prices_full.json`,
  psa: `${NAM_BASE}/psa_mapping.json`,
  fx: `${NAM_BASE}/exchange_rate.json`,
};

// แคชระดับโมดูล (lambda ใช้ซ้ำข้ามรีเควสต์) — กันโหลดไฟล์ใหญ่ซ้ำ ๆ
const TTL_MS = 30 * 60 * 1000; // 30 นาที
const cache = {}; // url -> { at, data }

async function getJson(url) {
  const c = cache[url];
  const now = Date.now();
  if (c && (now - c.at) < TTL_MS) return c.data;
  const r = await fetch(url, { headers: { 'User-Agent': 'Cielcard/1.0', Accept: 'application/json' } });
  if (!r.ok) throw new Error(`โหลด ${url} ไม่สำเร็จ (${r.status})`);
  const data = await r.json();
  cache[url] = { at: now, data };
  return data;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  // รับโค้ดการ์ด เช่น OP09-119 (ตัดช่องว่าง, ตัวพิมพ์ใหญ่) — ยอมรับ OP-09-119 / op09 119 ฯลฯ
  let code = String(req.query.code || '').trim().toUpperCase().replace(/\s+/g, '');
  // จับรูปแบบ (ตัวอักษร)(เลขเซ็ต)-(เลขการ์ด) ให้เป็น OP09-119
  const m = code.match(/([A-Z]+)-?(\d{1,2})-(\d{1,4})/) || code.match(/([A-Z]+)(\d{1,2})-(\d{1,4})/);
  if (m) code = `${m[1]}${m[2].padStart(2, '0')}-${m[3].padStart(3, '0')}`;
  if (!code || !/^[A-Z]+\d{1,2}-\d{1,4}$/.test(code)) {
    res.status(400).json({ error: 'กรุณาระบุโค้ดการ์ด เช่น ?code=OP09-119' });
    return;
  }

  try {
    const [prices, psaMap, fx] = await Promise.all([
      getJson(FILES.prices), getJson(FILES.psa), getJson(FILES.fx),
    ]);
    const jpyThb = (fx && fx.JPY && fx.JPY.selling) || fx.jpy_thb || 0.2084;
    const usdThb = (fx && fx.USD && fx.USD.selling) || fx.usd_thb || 32.79;

    // หา variant ทั้งหมดที่ตรงโค้ด: base (OP09-119) + parallel (OP09-119_p1.._pN)
    const re = new RegExp(`^${code}(_P\\d+)?$`, 'i');
    const variants = [];
    for (const setId of Object.keys(prices)) {
      const setData = prices[setId];
      if (!setData || typeof setData !== 'object') continue;
      for (const key of Object.keys(setData)) {
        if (key === '_meta') continue;
        if (!re.test(key)) continue;
        const card = setData[key];
        const rawJpy = Number(card.jpy) || 0;
        const rawThb = card.thb != null ? Number(card.thb) : Math.round(rawJpy * jpyThb);
        // PSA10 — psa_mapping ใช้คีย์ตัวพิมพ์ใหญ่ (_P2) ขณะ prices ใช้ _p2
        const pe = psaMap[key.toUpperCase()];
        let psa10Thb = null, psa10Jpy = null, psa10Usd = null, psa10Fmt = '';
        if (pe) {
          psa10Fmt = pe.psa10_ask_fmt || '';
          if (pe.psa10_ask_jpy != null) { psa10Jpy = pe.psa10_ask_jpy; psa10Thb = Math.round(pe.psa10_ask_jpy * jpyThb); }
          else if (pe.psa10_ask_usd != null) { psa10Usd = pe.psa10_ask_usd; psa10Thb = Math.round(pe.psa10_ask_usd * usdThb); }
        }
        variants.push({
          key, name: card.name || '', rarity: card.rarity || '', stock: !!card.stock,
          rawThb, rawJpy, psa10Thb, psa10Jpy, psa10Usd, psa10Fmt,
          image_url: card.image_url || '',
        });
      }
    }
    // เรียง: ใบปกติ (ไม่มี _p) ก่อน แล้วตามเลข parallel
    const pnum = k => { const mm = k.match(/_P(\d+)$/i); return mm ? parseInt(mm[1]) : 0; };
    variants.sort((a, b) => pnum(a.key) - pnum(b.key));

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
    res.status(200).json({
      found: variants.length > 0,
      code,
      jpyThb, usdThb,
      updated: (fx && fx.updated) || '',
      variants,
    });
  } catch (err) {
    res.status(502).json({ error: 'ดึงราคา NamTCG ไม่สำเร็จ: ' + (err.message || err) });
  }
}
