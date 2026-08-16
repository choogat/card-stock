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
function setSync(){}
function openImgUrl(){}
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
  + '\nexport { groupPrizes, gachaSummarySideHTML, openGachaSummary, toggleSumGroup, toggleSumPrize, toggleSumGroupAll, finishGachaReturn, prizeKey, asked, saves };'
  + '\nexport const setCanEdit = v => { canEdit = v; };'
  + '\nexport const setAnswer = v => { answer = v; };'
  + '\nexport const setBoxes = v => { gachaBoxes = v; };'
  + '\nexport const rendered = () => out;',
).toString('base64'));

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); } };

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
  assert.ok(b.gachaSumBody.includes('ติ๊กแล้ว 1/28'), 'หัวตารางต้องอัปเดตยอด');
  assert.ok(b.gachaSumBody.includes('1/10'), 'หัวกองต้องบอก 1/10');
});

t('ติ๊กทั้งกองทีเดียว และติ๊กออกทั้งกองได้', () => {
  openSum();
  mod.toggleSumGroupAll('luffy leader', true);
  assert.ok(mod.rendered().gachaSumBody.includes('ติ๊กแล้ว 10/28'));
  mod.toggleSumGroupAll('luffy leader', false);
  assert.ok(mod.rendered().gachaSumBody.includes('ติ๊กแล้ว 0/28'));
});

t('ติ๊กทั้งกองต้องไม่ไปโดนใบที่ออกไปแล้ว (ชื่อเดียวกันแต่คนละฝั่ง)', () => {
  openSum();
  mod.toggleSumGroupAll('op 16', true);
  assert.ok(mod.rendered().gachaSumBody.includes('ติ๊กแล้ว 18/28'), 'ต้องได้แค่ 18 ใบที่ยังไม่ออก');
});

console.log('\nคืนของสำเร็จ');

await (async () => {
  openSum();
  mod.toggleSumGroupAll('op 16', true);
  mod.setAnswer(true);
  await mod.finishGachaReturn();
  t('กดคืนของสำเร็จ → ล็อก ติ๊กไม่ได้อีก และขึ้นป้ายบอกว่าใครทำ', () => {
    const r = mod.rendered();
    assert.ok(r.gachaSumMeta.includes('คืนของสำเร็จแล้ว') && r.gachaSumMeta.includes('Cielcard'));
    assert.ok(r.gachaSumBody.includes('gsum-tick on locked') || r.gachaSumBody.includes('locked'), 'ช่องติ๊กต้องถูกล็อก');
    assert.equal(r['gachaSumDoneBtn:disabled'], true, 'ปุ่มต้องกดซ้ำไม่ได้');
  });
  t('popup ยืนยันบอกจำนวนที่ติ๊กไปแล้ว และเตือนเมื่อยังไม่ครบ', () => {
    const o = mod.asked[mod.asked.length - 1];
    assert.equal(o.title, 'ยืนยันคืนของสำเร็จ?');
    assert.equal(o.count, '18 / 28 ใบ');
    assert.ok(o.sub.includes('ยังติ๊กไม่ครบ'), 'ติ๊กไม่ครบต้องเตือน แต่ยังไปต่อได้');
  });
  t('ล็อกแล้วติ๊กเพิ่มไม่ได้จริง ๆ (ไม่ใช่แค่ซ่อนปุ่ม)', () => {
    const before = mod.rendered().gachaSumBody;
    mod.toggleSumPrize('n100');
    mod.toggleSumGroupAll('luffy leader', true);
    assert.equal(mod.rendered().gachaSumBody, before, 'ข้อมูลต้องไม่ขยับเลย');
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

console.log(`\n${fail ? '✗' : '✓'} ผ่าน ${pass} / ${pass + fail}\n`);
process.exit(fail ? 1 : 0);
