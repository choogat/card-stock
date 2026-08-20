// ทดสอบสรุปตู้จุ่ม (ของคงเหลือ / ของที่ออกไป) — ดึงโค้ดจริงออกมาจาก index.html
// รัน: node test-gacha.mjs
import fs from 'node:fs';
import assert from 'node:assert';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const start = html.indexOf('// ===== สรุปรวมตู้ที่จบงานแล้ว');
const end = html.indexOf('// กล่องสรุป 4 ช่อง');
assert.ok(start > 0 && end > start, 'หาบล็อกโค้ดสรุปตู้จุ่มไม่เจอ');

// refind ตัวจริง — ใช้หาตู้ใหม่หลัง await (กันลิสต์ถูกซิงก์ทับระหว่าง popup เปิดค้าง)
const refindSrc = html.slice(html.indexOf('function refind(arr, id)'), html.indexOf('// คืนค่า true = กดปุ่มหลัก'));

const stubs = `
function esc(s){ return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function money(n){ return '฿' + (Number(n)||0).toLocaleString('th-TH'); }
function fmtDate(d){ return d ? d.split('-').reverse().join('/') : ''; }
function shopById(id){ return id === 's1' ? { id:'s1', name:'25Cardshop' } : null; }
function prizeValueOf(p){ return Number(p && p.value) || 0; }
function invalidateCertIndex(){}
function sortPrizesByNo(a){ return a.slice(); }
function gachaBoxStats(b){
  const realPrizes = (b.prizes || []).filter(p => p && !p.header);
  return { realPrizes, drawn: realPrizes.filter(p => p.drawn).length };
}
let gachaBoxes = [];
function actWho(){ return 'Cielcard'; }
function actDayKey(t){ const d = new Date(Number(t)||0); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function canEditGacha(){ return canEdit; }
let canEdit = true;
const saves = [];
function saveGacha(){ saves.push(1); }
function renderGacha(){}
function render(){}
function setSync(){}
function openImgUrl(){}
let cards = [];
function save(){ saves.push('cards'); }
function todayISO(){ return '2026-08-18'; }
function nowHM(){ return '10:00'; }
let answer = true;
const asked = [];
function appConfirm(o){ asked.push(o); return Promise.resolve(answer); }
const out = {};
const el = id => ({ set textContent(v){ out[id] = v; }, set innerHTML(v){ out[id] = v; },
  style: {}, set disabled(v){ out[id + ':disabled'] = v; },
  classList: { add(){ out._open = true; }, remove(){ out._open = false; } } });
const document = { getElementById: el };
`;

const mod = await import('data:text/javascript;base64,' + Buffer.from(
  refindSrc + stubs + html.slice(start, end)
  + '\nexport { groupPrizes, gachaSummarySideHTML, openGachaSummary, toggleSumGroup, toggleSumPrize, toggleSumGroupAll, finishGachaReturn, prizeKey, asked, saves, fixGachaCards, syncGachaCardsBack, gachaPendingCards, gachaSumAction, gachaClaimScan, claimGachaCards };'
  + '\nexport const setCanEdit = v => { canEdit = v; };'
  + '\nexport const setAnswer = v => { answer = v; };'
  + '\nexport const setBoxes = v => { gachaBoxes = v; };'
  + '\nexport const setCards = v => { cards = v; };'
  + '\nexport const rendered = () => out;',
).toString('base64'));

let pass = 0, fail = 0;
const ok = name => { pass++; console.log('  ✓ ' + name); };
const bad = (name, e) => { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); };
// เทสต์ async ต้อง await ที่จุดเรียก ไม่งั้น assert จะไประเบิดทีหลังตอนเทสต์ถัดไปรีเซ็ตสถานะไปแล้ว
// (เคยเป็นแบบนั้นจริง — process.exit ท้ายไฟล์กลบไว้ เทสต์เลยขึ้น ✓ ทั้งที่ไม่เคยถูกตรวจ)
const t = (name, fn) => {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') return r.then(() => ok(name), e => bad(name, e));
    ok(name);
  } catch (e) { bad(name, e); }
};

// ตู้จำลอง: OP 16 จำนวน 30 ใบ (ออกไป 12) · Luffy 10 ใบ (ยังไม่ออก) · Zoro 5 ใบ (ออกหมด)
const box = () => {
  const p = [];
  for (let i = 0; i < 30; i++) p.push({ no: i + 1, name: 'OP 16', value: 1500, drawn: i < 12 });
  for (let i = 0; i < 10; i++) p.push({ no: 100 + i, name: 'Luffy Leader', value: 800 });
  for (let i = 0; i < 5; i++) p.push({ no: 200 + i, name: 'Zoro SR', value: 400, drawn: true });
  p.push({ header: true, name: '--- หัวข้อ ---' });   // แถวคั่น ไม่ใช่รางวัลจริง
  return { id: 'b1', name: 'OP16 Booster', date: '2026-08-16', shopId: 's1', done: true, prizes: p };
};

console.log('\nรวมรางวัลชื่อซ้ำ');

t('ของซ้ำรวมเป็นแถวเดียว บอกจำนวนแทนการไล่ทีละแถว', () => {
  const rows = mod.groupPrizes(box().prizes.filter(p => !p.header && !p.drawn));
  const op = rows.find(r => r.name === 'OP 16');
  assert.equal(op.n, 18, 'OP 16 เหลือ 18 (จาก 30 ออกไป 12)');
  assert.equal(op.value, 18 * 1500, 'มูลค่าต้องรวมทั้งแถว');
  assert.equal(rows.length, 2, 'เหลือ 2 ชื่อ: OP 16 กับ Luffy');
});

t('เรียงจากจำนวนมาก→น้อย ของเยอะสุดอยู่บนสุด', () => {
  const rows = mod.groupPrizes(box().prizes.filter(p => !p.header && !p.drawn));
  assert.deepEqual(rows.map(r => r.n), [18, 10]);
});

t('ชื่อเดียวกันแต่พิมพ์ต่างตัวใหญ่เล็ก/มีช่องว่าง ถือเป็นของเดียวกัน', () => {
  const rows = mod.groupPrizes([{ name: 'OP 16', value: 100 }, { name: ' op 16 ', value: 100 }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].n, 2);
  assert.equal(rows[0].name, 'OP 16', 'โชว์ตามที่พิมพ์ครั้งแรก');
});

t('ชื่อเดียวกันแต่มูลค่าต่างกัน ยังรวมแถวเดียว โชว์มูลค่ารวม', () => {
  const rows = mod.groupPrizes([{ name: 'OP 16', value: 1500 }, { name: 'OP 16', value: 1800 }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value, 3300);
});

console.log('\nตารางซ้าย-ขวา');

t('หัวตารางบอกจำนวนรางวัลและมูลค่ารวมของฝั่งนั้น', () => {
  const left = box().prizes.filter(p => !p.header && !p.drawn);
  const h = mod.gachaSummarySideHTML('ของคงเหลือ', '🎁', left, 'left');
  assert.ok(h.includes('28 รางวัล'), 'คงเหลือ 18+10 = 28');
  assert.ok(h.includes('มูลค่ารวม'), 'ต้องบอกมูลค่ารวมฝั่งนั้น');
  assert.ok(h.includes('× 18'));
});

t('ฝั่งที่ไม่มีของ ไม่พังและบอกว่าไม่มีรายการ', () => {
  const h = mod.gachaSummarySideHTML('ของที่ออกไป', '📤', [], 'right');
  assert.ok(h.includes('0 รางวัล') && h.includes('ไม่มีรายการ'));
});

t('เปิดสรุป: ซ้าย=ยังไม่ออก ขวา=ออกไปแล้ว และไม่นับแถวหัวข้อเป็นรางวัล', () => {
  mod.setBoxes([box()]);
  mod.openGachaSummary('b1');
  const r = mod.rendered();
  assert.ok(r.gachaSumTitle.includes('OP16 Booster'));
  assert.ok(r.gachaSumMeta.includes('25Cardshop') && r.gachaSumMeta.includes('45 รางวัลทั้งหมด'), 'ได้: ' + r.gachaSumMeta);
  assert.ok(r.gachaSumBody.includes('ของคงเหลือ') && r.gachaSumBody.includes('28 รางวัล'));
  assert.ok(r.gachaSumBody.includes('ของที่ออกไป') && r.gachaSumBody.includes('17 รางวัล'), 'ออกไป 12+5 = 17');
  assert.ok(!r.gachaSumBody.includes('หัวข้อ'), 'แถวคั่นต้องไม่ถูกนับเป็นรางวัล');
  assert.equal(r._open, true, 'ต้องเปิด popup');
});

t('เนื้อหาจากผู้ใช้ถูก escape ไม่หลุดเป็น HTML', () => {
  const h = mod.gachaSummarySideHTML('x', '🎁', [{ name: '<script>x</' + 'script>', value: 1 }], 'left');
  assert.ok(!h.includes('<script'));
});

console.log('\nกางดูรายใบ + ติ๊กเช็คของ');

const openSum = () => { mod.setBoxes([box()]); mod.openGachaSummary('b1'); };

t('กดแถวแล้วกางรายใบออกมา กดซ้ำแล้วยุบ', () => {
  openSum();
  assert.ok(!mod.rendered().gachaSumBody.includes('gsum-items'), 'ตอนแรกยังไม่กาง');
  mod.toggleSumGroup('left', 'op 16');
  assert.ok(mod.rendered().gachaSumBody.includes('gsum-items'), 'กดแล้วต้องกาง');
  mod.toggleSumGroup('left', 'op 16');
  assert.ok(!mod.rendered().gachaSumBody.includes('gsum-items'), 'กดซ้ำต้องยุบ');
});

t('รางวัลที่ไม่มีรูป/cert แสดงแค่ชื่อ ไม่มีช่องว่างเปล่า', () => {
  mod.setBoxes([{ id: 'b2', name: 'x', prizes: [{ no: '', name: 'ของไม่มีข้อมูล' }] }]);
  mod.openGachaSummary('b2');
  mod.toggleSumGroup('left', 'ของไม่มีข้อมูล');
  const h = mod.rendered().gachaSumBody;
  assert.ok(h.includes('ของไม่มีข้อมูล'));
  assert.ok(h.includes('gsum-thumb none'), 'ไม่มีรูป = ไอคอนแทน');
  assert.ok(!h.includes('gsum-ibits'), 'ไม่มีเลข/cert/มูลค่า = ไม่ต้องมีบรรทัดรายละเอียด');
});

t('ติ๊กได้เฉพาะฝั่งคงเหลือ ฝั่งที่ออกไปแล้วไม่มีช่องติ๊ก', () => {
  openSum();
  const h = mod.rendered().gachaSumBody;
  const left = h.slice(h.indexOf('gsum-side left'), h.indexOf('gsum-side right'));
  const right = h.slice(h.indexOf('gsum-side right'));
  assert.ok(left.includes('gsum-tick'), 'ฝั่งคงเหลือต้องติ๊กได้');
  assert.ok(!right.includes('gsum-tick'), 'ฝั่งออกไปแล้วไม่ต้องมีช่องติ๊ก');
});

t('ติ๊กรายใบแล้วบันทึกลงรางวัลใบนั้น และนับรวมให้ที่หัวตาราง', () => {
  openSum();
  mod.toggleSumGroup('left', 'luffy leader');
  mod.toggleSumPrize('n100');
  const b = mod.rendered();
  assert.ok(b.gachaSumBody.includes('ติ๊กรอปิดอีก 1'), 'หัวตารางต้องอัปเดตยอด');
  assert.ok(b.gachaSumBody.includes('ติ๊ก 1'), 'หัวกองต้องบอกว่าติ๊กไว้ 1 ใบ');
});

t('ติ๊กทั้งกองทีเดียว และติ๊กออกทั้งกองได้', () => {
  openSum();
  mod.toggleSumGroupAll('luffy leader', true);
  assert.ok(mod.rendered().gachaSumBody.includes('ติ๊กรอปิดอีก 10'));
  mod.toggleSumGroupAll('luffy leader', false);
  assert.ok(!mod.rendered().gachaSumBody.includes('ติ๊กรอปิดอีก'));
});

t('ติ๊กทั้งกองต้องไม่ไปโดนใบที่ออกไปแล้ว (ชื่อเดียวกันแต่คนละฝั่ง)', () => {
  openSum();
  mod.toggleSumGroupAll('op 16', true);
  assert.ok(mod.rendered().gachaSumBody.includes('ติ๊กรอปิดอีก 18'), 'ต้องได้แค่ 18 ใบที่ยังไม่ออก');
});

// ชื่อจริงจากตู้ 19999/109 Onepiece Aisa Card Show ที่เคยกดติ๊กไม่ได้
const quoteBox = () => ({
  id: 'bq', name: 'quote', prizes: [
    { no: 28, name: "YOU'LL FRIGHTEN ME...", value: 100 },
    { no: 16, name: 'EUSTASS "CAPTAIN" KID', value: 200 },
    { no: 17, name: 'EUSTASS "CAPTAIN" KID', value: 200 },
    { no: 29, name: 'ปกติ<script>', value: 50 },
  ],
});

t("ชื่อที่มี ' หรือ \" กดกางและติ๊กได้ (เคยกดแล้วเงียบ)", () => {
  mod.setBoxes([quoteBox()]);
  mod.openGachaSummary('bq');
  const h = mod.rendered().gachaSumBody;
  // คีย์ใน onclick ต้องไม่มีเครื่องหมายที่ทำให้สตริง/แอตทริบิวต์ปิดก่อนเวลา
  const keys = [...h.matchAll(/toggleSumGroupAll\('([^']*)'/g)].map(m => m[1]);
  assert.ok(keys.length, 'ต้องมีปุ่มติ๊กทั้งกอง');
  assert.ok(!keys.some(k => /['"]|&#39;|&quot;/.test(k)), 'คีย์ต้องถูกเข้ารหัสแล้ว ได้: ' + keys.join(' | '));
  // ติ๊กด้วยคีย์ที่เข้ารหัสแบบเดียวกับที่ปุ่มส่งมา ต้องมีผลจริง
  const k = encodeURIComponent("you'll frighten me...").replace(/'/g, '%27');
  mod.toggleSumGroupAll(k, true);
  assert.ok(mod.rendered().gachaSumBody.includes('ติ๊กรอปิดอีก 1'), 'ติ๊กใบที่ชื่อมี \' ต้องได้');
  const k2 = encodeURIComponent('eustass "captain" kid').replace(/'/g, '%27');
  mod.toggleSumGroupAll(k2, true);
  assert.ok(mod.rendered().gachaSumBody.includes('ติ๊กรอปิดอีก 3'), 'ติ๊กใบที่ชื่อมี " ต้องได้');
});

t("กางกองที่ชื่อมี ' ได้ และชื่อไม่หลุดเป็น HTML", () => {
  mod.setBoxes([quoteBox()]);
  mod.openGachaSummary('bq');
  mod.toggleSumGroup('left', encodeURIComponent("you'll frighten me...").replace(/'/g, '%27'));
  const h = mod.rendered().gachaSumBody;
  assert.ok(h.includes('gsum-items'), 'ต้องกางได้');
  assert.ok(!h.includes('<script>'), 'ชื่อที่มีแท็กต้องถูก escape');
});

console.log('\nคืนของสำเร็จ');

// รอบที่ 1 — ปิดแค่กอง OP 16 (18 ใบ) เหลือ Luffy 10 ใบไว้ปิดรอบหน้า
await (async () => {
  openSum();
  mod.toggleSumGroupAll('op 16', true);
  mod.setAnswer(true);
  await mod.finishGachaReturn();
  t('ปิดบางส่วน: ใบที่ปิดแล้วล็อก · ใบที่เหลือยังติ๊กได้ · ปุ่มยังกดได้', () => {
    const r = mod.rendered();
    assert.ok(r.gachaSumMeta.includes('คืนของสำเร็จแล้ว 18/28'), 'ได้: ' + r.gachaSumMeta);
    assert.ok(r.gachaSumBody.includes('คืนแล้ว 18'), 'หัวกองต้องบอกว่าคืนแล้วกี่ใบ');
    assert.ok(!r['gachaSumDoneBtn:disabled'], 'ยังเหลือของ ปุ่มต้องกดได้อีก');
  });
  t('popup ยืนยันบอกว่ารอบนี้ปิดกี่ใบ และเหลืออีกกี่ใบ', () => {
    const o = mod.asked[mod.asked.length - 1];
    assert.equal(o.title, 'ยืนยันคืนของสำเร็จ?');
    assert.equal(o.count, '18 ใบ', 'นับเฉพาะที่ติ๊กใหม่ในรอบนี้');
    assert.ok(o.sub.includes('เหลืออีก 10 ใบ'), 'ได้: ' + o.sub);
  });
  t('ใบที่ปิดแล้วติ๊กออกไม่ได้ แต่ใบที่ยังไม่ปิดติ๊กได้', () => {
    mod.toggleSumPrize('n13');                    // ใบในกอง OP 16 ที่ปิดไปแล้ว
    assert.ok(mod.rendered().gachaSumBody.includes('คืนแล้ว 18'), 'ใบที่ปิดแล้วต้องไม่ขยับ');
    mod.toggleSumPrize('n100');                   // ใบในกอง Luffy ที่ยังเปิดอยู่
    assert.ok(mod.rendered().gachaSumBody.includes('ติ๊กรอปิดอีก 1'), 'ใบที่ยังไม่ปิดต้องติ๊กได้');
  });
  // รอบที่ 2 — ปิดที่เหลือให้ครบ
  await t('ปิดครบทั้งตู้ → ปุ่มกดไม่ได้อีก', async () => {
    mod.toggleSumGroupAll('luffy leader', true);
    await mod.finishGachaReturn();
    const r = mod.rendered();
    assert.ok(r.gachaSumMeta.includes('คืนของสำเร็จแล้ว 28/28'), 'ได้: ' + r.gachaSumMeta);
    assert.equal(r['gachaSumDoneBtn:disabled'], true);
  });
})();

await (async () => {
  openSum();
  mod.setAnswer(true);
  await mod.finishGachaReturn();
  t('ยังไม่ติ๊กใบใหม่ แล้วกดปุ่ม → บอกให้ติ๊กก่อน ไม่ปิดอะไรให้', () => {
    const o = mod.asked[mod.asked.length - 1];
    assert.equal(o.title, 'ยังไม่ได้ติ๊กใบใหม่');
    assert.ok(!mod.rendered().gachaSumMeta.includes('คืนของสำเร็จแล้ว'));
  });
})();

console.log('\nปิดครบทั้งตู้ → จัดการ์ดในคลังให้');

await (async () => {
  // การ์ดในคลังผูกกับตู้ด้วย "เบอร์ในตู้" — #1 ยังอยู่ในตู้ · #13 จุ่มออกไปแล้ว · #999 หารางวัลไม่เจอ
  const backCard = { id: 'k1', name: 'A', status: 'wait', gachaBoxId: 'b1', gachaNo: 100 };
  const soldCard = { id: 'k2', name: 'B', status: 'wait', gachaBoxId: 'b1', gachaNo: 1, sell: 5000 };
  const orphan = { id: 'k3', name: 'C', status: 'wait', gachaBoxId: 'b1', gachaNo: 999 };
  const other = { id: 'k4', name: 'D', status: 'wait' };
  mod.setCards([backCard, soldCard, orphan, other]);
  openSum();
  mod.toggleSumGroupAll('op 16', true);
  mod.toggleSumGroupAll('luffy leader', true);
  mod.setAnswer(true);
  await mod.finishGachaReturn();
  t('รางวัลที่ยังอยู่ในตู้ → การ์ดกลับเป็นสะสม และหลุดจากตู้', () => {
    assert.equal(backCard.status, 'show');
    assert.equal(backCard.gachaBoxId, undefined);
    assert.equal(backCard.gachaNo, undefined);
  });
  t('รางวัลที่จุ่มออกไปแล้ว → การ์ดลงขายแล้ว ยอด 0 (ไม่นับเงินซ้ำกับยอดจุ่ม)', () => {
    assert.equal(soldCard.status, 'sold');
    assert.equal(soldCard.sell, 0, 'ยอดขายต้องเป็น 0 เพราะเงินอยู่ที่ยอดจุ่มแล้ว');
    assert.equal(soldCard.viaGacha, true, 'ต้องติดป้ายว่าออกไปทางตู้จุ่ม');
    assert.equal(soldCard.sellDate, '2026-08-16', 'ใช้วันของตู้');
    assert.equal(soldCard.gachaBoxId, 'b1', 'คงการผูกไว้เป็นประวัติว่าออกจากตู้ไหน');
  });
  // เคสจริงจากตู้ 19999/109: การ์ดผูกเบอร์ 111 แต่ตู้มีแค่ 110 ช่อง (รางวัลถูกลบหลังผูก)
  // เดิมระบบไม่แตะให้ ของค้างผูกตู้ตลอด — ตอนนี้ถือว่าของยังอยู่กับเรา คืนเข้าคลังให้
  t('การ์ดที่หารางวัลตามเบอร์ไม่เจอ → คืนเข้าคลังเป็นสะสม + แจ้งว่าทำอะไรไป', () => {
    assert.equal(orphan.status, 'show', 'ต้องไม่ค้างเป็นรอขายผูกตู้');
    assert.equal(orphan.gachaBoxId, undefined, 'ต้องหลุดจากตู้');
    const o = mod.asked[mod.asked.length - 1];
    assert.ok(o.title.includes('คืนเข้าคลังให้แล้ว'), 'ได้: ' + o.title);
  });
  t('การ์ดที่ไม่เกี่ยวกับตู้นี้ ไม่ถูกแตะ', () => {
    assert.equal(other.status, 'wait');
  });
})();

// ตู้ปิดคืนของครบไปแล้ว แต่มีการ์ดมาผูกทีหลัง → ปุ่มหลักต้องกดได้ ไม่ใช่ปุ่มตาย
await (async () => {
  const b = box();
  b.prizes.filter(p => !p.header && !p.drawn).forEach(p => { p.retOk = true; });
  b.retDone = true;
  mod.setBoxes([b]);
  const late = { id: 'k9', name: 'มาผูกทีหลัง', status: 'wait', gachaBoxId: 'b1', gachaNo: 100 };
  mod.setCards([late]);
  mod.openGachaSummary('b1');
  t('ตู้ที่ปิดแล้วแต่ยังมีการ์ดค้างผูก → ขึ้นแถบเตือนบอกจำนวน', () => {
    const h = mod.rendered().gachaSumBody;
    assert.ok(h.includes('gsum-stuck') && h.includes('1 ใบ'), 'ต้องเตือนว่ามีการ์ดค้าง');
  });
  t('แถบเตือนไม่มีปุ่มซ้อน — งานจัดของอยู่ที่ปุ่มหลักปุ่มเดียว', () => {
    assert.ok(!mod.rendered().gachaSumBody.includes('<button'), 'แถบเตือนต้องเป็นข้อความอย่างเดียว');
  });
  t('ปุ่มหลักกดได้ และบอกว่ามีกี่ใบรอจัด', () => {
    const r = mod.rendered();
    assert.equal(r['gachaSumDoneBtn:disabled'], false, 'ต้องกดได้');
    assert.ok(r.gachaSumDoneBtn.includes('จบงาน') && r.gachaSumDoneBtn.includes('1 ใบรอจัด'),
      'ได้: ' + r.gachaSumDoneBtn);
  });
  mod.setAnswer(true);
  await mod.gachaSumAction();                 // กดปุ่มหลักตัวจริง
  t('กดปุ่มหลักแล้วถามยืนยันก่อน แล้วค่อยจัดให้', () => {
    const o = mod.asked[mod.asked.length - 1];
    assert.ok(o.title.includes('จบงาน'), 'ต้องมี popup ยืนยัน · ได้: ' + o.title);
    assert.equal(o.okText, 'จบงาน');
  });
  t('จัดแล้ว การ์ดกลับเข้าคลัง และแถบเตือนหายไป', () => {
    assert.equal(late.status, 'show');
    assert.equal(late.gachaBoxId, undefined);
    assert.ok(!mod.rendered().gachaSumBody.includes('gsum-stuck'));
  });
  t('จบงานครบแล้ว → ปุ่มเป็น "จบงานแล้ว" สีเทา กดไม่ได้', () => {
    const r = mod.rendered();
    assert.equal(r['gachaSumDoneBtn:disabled'], true, 'ต้องกดไม่ได้แล้ว');
    assert.ok(r.gachaSumDoneBtn.includes('จบงานแล้ว'), 'ได้: ' + r.gachaSumDoneBtn);
  });
})();

// ใบที่จุ่มออกไปแล้วและลงขายแล้ว ยังผูก gachaBoxId ไว้เป็นประวัติ — ต้องไม่ถูกนับว่าค้าง
// ไม่งั้นตู้ที่มีของออกไปจะขึ้น "รอจัด" ค้างตลอด กดจบงานเท่าไหร่ก็ไม่หาย
await (async () => {
  const b = box();
  b.prizes.filter(p => !p.header && !p.drawn).forEach(p => { p.retOk = true; });
  b.retDone = true;
  mod.setBoxes([b]);
  const drawnNo = b.prizes.find(p => p && !p.header && p.drawn).no;
  const history = { id: 'h1', name: 'ออกไปแล้ว', status: 'sold', gachaBoxId: 'b1', gachaNo: drawnNo };
  mod.setCards([history]);
  mod.openGachaSummary('b1');
  t('การ์ดที่ขายแล้วผ่านตู้ ไม่นับเป็นของค้าง', () => {
    assert.equal(mod.gachaPendingCards(b).length, 0);
    assert.ok(!mod.rendered().gachaSumBody.includes('gsum-stuck'), 'ต้องไม่ขึ้นแถบเตือน');
  });
  t('ตู้ที่จบครบแล้ว ปุ่มขึ้น "จบงานแล้ว" กดไม่ได้', () => {
    const r = mod.rendered();
    assert.equal(r['gachaSumDoneBtn:disabled'], true);
    assert.ok(r.gachaSumDoneBtn.includes('จบงานแล้ว'), 'ได้: ' + r.gachaSumDoneBtn);
  });
})();

// เคสจริงตู้ 19999/109: ก็อปตู้มาใช้ซ้ำ รางวัลตามมาแต่การ์ดยังผูกตู้เดิม
// ปิดคืนของตู้ใหม่แล้วของในคลังไม่เปลี่ยนสถานะ เพราะไม่มีการ์ดใบไหนผูกกับตู้ใหม่เลย
console.log('\nการ์ดผูกค้างอยู่กับตู้ที่ก็อปมา');
await (async () => {
  const b = box();                                     // ตู้ใหม่ (ก็อปมา) — ปิดคืนของครบแล้ว
  b.prizes.filter(p => !p.header && !p.drawn).forEach(p => { p.retOk = true; });
  b.retDone = true;
  b.prizes.find(p => String(p.no) === '1').cert = 'C1';
  b.prizes.find(p => String(p.no) === '2').cert = 'C2';
  b.prizes.find(p => String(p.no) === '3').cert = 'C3';
  const old = { id: 'b0', name: 'ตู้เดิมที่ก็อปมา', prizes: b.prizes.slice() };
  const other = { id: 'b9', name: 'ตู้โปเกมอนคนละงาน', prizes: [{ no: 100, name: 'Pikachu' }] };
  mod.setBoxes([b, old, other]);
  const good = { id: 'g1', name: 'OP 16', cert: 'C1', status: 'wait', gachaBoxId: 'b0', gachaNo: 1 };
  const byName = { id: 'g2', name: 'Luffy Leader', status: 'wait', gachaBoxId: 'b0', gachaNo: 100 };
  const wrong = { id: 'g3', name: 'OP 16', cert: 'C9', status: 'wait', gachaBoxId: 'b0', gachaNo: 3 };
  const free = { id: 'g4', name: 'OP 16', cert: 'C1', status: 'show', gachaNo: 1 };
  const moved = { id: 'g5', name: 'OP 16', cert: 'C2', status: 'wait', gachaBoxId: 'b0', gachaNo: 999 };
  const alien = { id: 'g6', name: 'Luffy Leader', status: 'wait', gachaBoxId: 'b9', gachaNo: 100 };
  mod.setCards([good, byName, wrong, free, moved, alien]);
  mod.openGachaSummary('b1');

  t('cert ตรง → ย้ายได้ · ไม่มี cert ทั้งคู่ → เทียบเบอร์+ชื่อแทน', () => {
    const s = mod.gachaClaimScan(b);
    assert.ok(s.ok.some(x => x.card.id === 'g1'), 'g1 ต้องเข้าด้วย cert');
    assert.ok(s.ok.some(x => x.card.id === 'g2'), 'g2 ต้องเข้าด้วยเบอร์+ชื่อ');
  });
  t('cert ตรงแต่คนละเบอร์ ก็ยังจับคู่ได้ (เบอร์เริ่มใหม่ทุกตู้ จะยึดเบอร์ไม่ได้)', () => {
    const hit = mod.gachaClaimScan(b).ok.find(x => x.card.id === 'g5');
    assert.ok(hit, 'g5 มี cert C2 ต้องเจอรางวัล #2 แม้การ์ดจะเป็นเบอร์ 999');
    assert.equal(String(hit.prize.no), '2');
  });
  t('เบอร์ตรงแต่ cert คนละใบ → ไม่ย้ายให้ แยกไว้เตือน', () => {
    assert.deepEqual(mod.gachaClaimScan(b).clash.map(x => x.card.id), ['g3']);
  });
  // เบอร์ในตู้เริ่มที่ 1 ใหม่ทุกตู้ ถ้าจับคู่ด้วยเบอร์อย่างเดียว การ์ดจากงานอื่นจะถูกดูดมาด้วย
  t('การ์ดจากตู้ที่ไม่มี cert ตรงกันเลย = คนละงาน ต้องไม่ถูกดูดมา', () => {
    const s = mod.gachaClaimScan(b);
    assert.ok(![...s.ok, ...s.clash].some(x => x.card.id === 'g6'),
      'g6 อยู่ตู้ b9 ที่ไม่เกี่ยวกัน แม้เบอร์+ชื่อจะตรงก็ห้ามย้าย');
  });
  t('การ์ดที่ไม่ได้ผูกตู้ไหนอยู่ ไม่ถูกดึงมา (ไม่ใช่ของที่ค้าง)', () => {
    const s = mod.gachaClaimScan(b);
    assert.ok(![...s.ok, ...s.clash].some(x => x.card.id === 'g4'));
  });
  t('ขึ้นแถบชวนย้าย บอกจำนวน + ชื่อตู้ต้นทาง + เตือนใบที่ของไม่ตรง', () => {
    const h = mod.rendered().gachaSumBody;
    assert.ok(h.includes('gsum-claim') && h.includes('3 ใบ'), 'ต้องบอกว่าย้ายได้ 3 ใบ');
    assert.ok(h.includes('ตู้เดิมที่ก็อปมา'), 'ต้องบอกว่าย้ายมาจากตู้ไหน');
    assert.ok(h.includes('claimGachaCards()'), 'ต้องมีปุ่มย้าย');
    assert.ok(h.includes('อีก 1 ใบ'), 'ต้องเตือนใบที่ของไม่ตรง');
  });
  t('ตู้ยังไม่มีการ์ดผูก → ปุ่มหลักยังเป็น "จบงานแล้ว" (ไม่มีอะไรให้จัด)', () => {
    assert.ok(mod.rendered().gachaSumDoneBtn.includes('จบงานแล้ว'));
  });

  mod.setAnswer(true);
  await mod.claimGachaCards();
  t('กดย้ายแล้วถามยืนยันก่อน และบอกว่ายังไม่เปลี่ยนสถานะ', () => {
    const o = mod.asked[mod.asked.length - 1];
    assert.ok(o.title.includes('ย้ายการ์ดมาผูกตู้นี้'), 'ได้: ' + o.title);
    assert.ok(o.sub.includes('ยังไม่เปลี่ยนสถานะ'), 'ต้องบอกว่าต้องกดจบงานอีกที');
  });
  t('ย้ายแล้วการ์ดมาผูกตู้นี้ แต่สถานะยังไม่เปลี่ยน (รอผู้ใช้ทวนก่อน)', () => {
    assert.equal(good.gachaBoxId, 'b1');
    assert.equal(byName.gachaBoxId, 'b1');
    assert.equal(good.status, 'wait', 'ยังไม่จัดสถานะให้ในขั้นนี้');
    assert.equal(wrong.gachaBoxId, 'b0', 'ใบที่ของไม่ตรงต้องอยู่ตู้เดิม');
  });
  t('ย้ายเสร็จ ปุ่มหลักเปลี่ยนเป็น "จบงาน" พร้อมจำนวนที่รอจัด', () => {
    const r = mod.rendered();
    assert.equal(r['gachaSumDoneBtn:disabled'], false);
    assert.ok(r.gachaSumDoneBtn.includes('จบงาน') && r.gachaSumDoneBtn.includes('3 ใบรอจัด'),
      'ได้: ' + r.gachaSumDoneBtn);
  });

  await mod.gachaSumAction();
  t('กดจบงานต่อ → #1 จุ่มออกไปแล้วลงขายแล้ว · #100 ยังอยู่ในตู้กลับเป็นสะสม', () => {
    assert.equal(good.status, 'sold', '#1 อยู่ใน 12 ใบแรกที่ drawn');
    assert.equal(byName.status, 'show');
    assert.equal(byName.gachaBoxId, undefined, 'ใบที่กลับเข้าคลังต้องหลุดจากตู้');
  });
  t('จัดครบแล้ว แถบชวนย้ายและปุ่มจบงานหายไป เหลือ "จบงานแล้ว"', () => {
    const r = mod.rendered();
    assert.ok(!r.gachaSumBody.includes('gsum-claim'), 'ไม่มีใบให้ย้ายแล้ว');
    assert.equal(r['gachaSumDoneBtn:disabled'], true);
    assert.ok(r.gachaSumDoneBtn.includes('จบงานแล้ว'));
  });
})();

// ยังคืนของไม่ครบ → ปุ่มต้องยังเป็น "คืนของสำเร็จ" ตามเดิม ไม่กระโดดไปจบงาน
await (async () => {
  const b = box();
  mod.setBoxes([b]);
  mod.setCards([{ id: 'k1', name: 'ค้าง', status: 'wait', gachaBoxId: 'b1', gachaNo: 100 }]);
  mod.openGachaSummary('b1');
  t('ตู้ที่ยังคืนของไม่ครบ → ปุ่มคือ "คืนของสำเร็จ" และกดได้', () => {
    const r = mod.rendered();
    assert.equal(r['gachaSumDoneBtn:disabled'], false);
    assert.ok(r.gachaSumDoneBtn.includes('คืนของสำเร็จ'), 'ได้: ' + r.gachaSumDoneBtn);
    assert.ok(!r.gachaSumBody.includes('gsum-stuck'), 'ยังไม่ปิดคืนของ ไม่ต้องเตือนเรื่องการ์ดค้าง');
  });
})();

await (async () => {
  openSum();
  mod.setCanEdit(false);
  await mod.finishGachaReturn();
  t('คนที่ไม่มีสิทธิ์แก้ตู้จุ่ม กดคืนของสำเร็จไม่ได้', () => {
    assert.ok(!mod.rendered().gachaSumMeta.includes('คืนของสำเร็จแล้ว'));
  });
  mod.setCanEdit(true);
})();

console.log('\nยืนยันก่อนย้ายตู้ข้ามแท็บ');

// ดึงตัวเลือกที่ส่งเข้า popup ออกมาจากโค้ดจริง (ทั้ง 2 ทิศทาง)
const doneSrc = html.slice(html.indexOf('async function markGachaDone'), html.indexOf('// ===== สรุปรวมตู้ที่จบงานแล้ว'));
const asked2 = [];
let onAsk = null, answer2 = false;
const mkRunner = (boxesRef) => new Function('appConfirm', 'gachaBoxStats', 'shopById', 'money', 'saveGacha', 'canEditGacha', 'gachaBoxes', 'renderGacha', `
  let gachaReflowTimer = null;
  const setTimeout = () => {};
  const clearTimeout = () => {};
  ${refindSrc}
  ${doneSrc}
  return markGachaDone;
`)(
  o => { asked2.push(o); if (onAsk) onAsk(); return Promise.resolve(answer2); },
  b => ({ realPrizes: (b.prizes || []), drawn: 12, profit: -500 }),
  () => ({ name: '25Cardshop' }),
  n => '฿' + n,
  () => {}, () => true,
  boxesRef, () => {},
);
const boxesRef = [box()];
const runDone = mkRunner(boxesRef);

await (async () => {
  await runDone(null, 'b1', true);
  await runDone(null, 'b1', false);
})();

t('จบงาน: ถามยืนยัน พร้อมตัวเลขให้ทวนก่อนกด', () => {
  const o = asked2[0];
  assert.equal(o.title, 'จบงานตู้จุ่มนี้?');
  assert.equal(o.okText, 'จบงาน');
  assert.ok(o.sub.includes('OP16 Booster') && o.sub.includes('25Cardshop'));
  assert.ok(o.sub.includes('ออกไปแล้ว 12'), 'ต้องบอกว่าติ๊กไปแล้วกี่รางวัล');
  assert.ok(o.sub.includes('ขาดทุน'), 'กำไรติดลบต้องอ่านว่าขาดทุน');
});

t('เปิดงานใหม่: ถามยืนยันเหมือนกัน และบอกว่าจะเกิดอะไรขึ้น', () => {
  const o = asked2[1];
  assert.equal(o.title, 'เปิดงานตู้จุ่มนี้ใหม่?');
  assert.equal(o.okText, 'เปิดงานใหม่');
  assert.ok(o.sub.includes('ใช้งานอยู่'), 'ต้องบอกว่าตู้จะกลับไปแท็บไหน');
});

t('กดยกเลิกใน popup แล้วสถานะตู้ต้องไม่เปลี่ยน', () => {
  assert.equal(boxesRef[0].done, true, 'ตู้ยังจบงานอยู่เหมือนเดิม');
  assert.equal(asked2.length, 2, 'ถามครบทั้ง 2 ทิศทาง');
});

await (async () => {
  // ของจริงที่เคยพัง: ระหว่าง popup เปิดค้าง การซิงก์ดึงข้อมูลใหม่มาแทนที่ทั้งอาร์เรย์
  // ตู้ที่ find() ไว้ก่อน await กลายเป็นออบเจ็กต์ลอย — กดเปิดงานใหม่แล้วตู้ไม่กลับมาแท็บ "ใช้งานอยู่"
  const stale = boxesRef[0];
  const fresh = { ...box(), done: true };
  answer2 = true;
  onAsk = () => { boxesRef.length = 0; boxesRef.push(fresh); };
  await runDone(null, 'b1', false);
  onAsk = null;
  t('ซิงก์มาทับระหว่าง popup เปิดค้าง — เปิดงานใหม่ต้องยังมีผลกับตู้ตัวจริง', () => {
    assert.equal(fresh.done, false, 'ตู้ในลิสต์ล่าสุดต้องกลับไปใช้งานอยู่');
    assert.equal(stale.done, true, 'ตัวเก่าที่หลุดจากลิสต์แล้ว ไม่ต้องไปยุ่ง');
  });
})();


// ===== ราคารางวัลตามราคาการ์ดในคลัง (เปิด/ปิดรายตู้) =====
// ดึงตัวจริงออกมาจาก index.html — บล็อกนี้อยู่คนละที่กับโค้ดสรุปตู้
console.log('\nราคาตามคลัง (รายตู้)');
{
  const pvStart = html.indexOf('// รางวัลที่พิมพ์/นำเข้า/ก็อปมา ไม่มี cardId');
  const pvEnd = html.indexOf('// คำนวณสรุปของตู้หนึ่งใบ');
  assert.ok(pvStart > 0 && pvEnd > pvStart, 'หาบล็อก prizeValueOf ไม่เจอ');
  const pv = await import('data:text/javascript;base64,' + Buffer.from(
    'let cards = [];\n' + html.slice(pvStart, pvEnd)
    + '\nexport { prizeValueOf, invalidateCertIndex };'
    + '\nexport const setCards = v => { cards = v; invalidateCertIndex(); };',
  ).toString('base64'));

  const card = { id: 'c1', cert: '111', sell: 5000 };
  pv.setCards([card, { id: 'c2', cert: '222', sell: 900 }]);
  const prize = { no: '1', cert: '111', name: 'LUFFY', value: 3000 };
  const off = { id: 'x', prizes: [prize] };
  const on = { id: 'x', prizes: [prize], livePrice: true };

  t('ปิดอยู่ (ค่าเริ่มต้น) → ใช้ราคาที่บันทึกไว้ ตู้เก่าไม่ขยับเอง', () => {
    assert.equal(pv.prizeValueOf(prize, off), 3000);
    assert.equal(pv.prizeValueOf(prize), 3000, 'ไม่ส่งตู้มาก็ต้องได้ค่าเดิม');
  });
  t('เปิดแล้ว → ดึงราคาขายของการ์ดที่ cert ตรงกัน', () => {
    assert.equal(pv.prizeValueOf(prize, on), 5000);
  });
  t('แก้ราคาขายที่คลัง แล้วตู้ที่เปิดไว้ขยับตามทันที', () => {
    card.sell = 7500;
    pv.invalidateCertIndex();
    assert.equal(pv.prizeValueOf(prize, on), 7500);
    assert.equal(pv.prizeValueOf(prize, off), 3000, 'ตู้ที่ปิดไว้ต้องไม่ขยับ');
  });
  t('cert หาการ์ดไม่เจอ → ใช้ราคาที่บันทึกไว้ ไม่กลายเป็น 0', () => {
    const orphan = { no: '9', cert: '999', value: 1200 };
    assert.equal(pv.prizeValueOf(orphan, on), 1200);
  });
  t('รางวัลไม่มี cert → ใช้ราคาที่บันทึกไว้', () => {
    assert.equal(pv.prizeValueOf({ no: '2', name: 'x', value: 800 }, on), 800);
  });
  t('การ์ดราคาขาย 0 → ไม่ทับราคาที่บันทึกไว้ด้วยเลข 0', () => {
    pv.setCards([{ id: 'c3', cert: '111', sell: 0 }]);
    assert.equal(pv.prizeValueOf(prize, on), 3000);
  });
  t('cardId ยังมาก่อนเสมอ — ของเดิมที่ส่งจากขายสินค้าไม่เปลี่ยนพฤติกรรม', () => {
    pv.setCards([{ id: 'cc', cert: '111', sell: 4444 }]);
    const linked = { no: '1', cert: '111', value: 3000, cardId: 'cc' };
    assert.equal(pv.prizeValueOf(linked, off), 4444, 'ผูก cardId ไว้ ต้องวิ่งตามแม้ตู้จะปิดสวิตช์');
  });
}

console.log(`\n${fail ? '✗' : '✓'} ผ่าน ${pass} / ${pass + fail}`);
if (fail) process.exit(1);
