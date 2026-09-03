// ทดสอบสิทธิ์เมนู (allowedTabs / canViewTab / isShopAccount) — ดึงโค้ดจริงออกมาจาก index.html
// รัน: node test-perm.mjs
import fs from 'node:fs';
import assert from 'node:assert';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const cut = (a, b) => {
  const s = html.indexOf(a), e = html.indexOf(b);
  assert.ok(s > 0 && e > s, 'หาบล็อกไม่เจอ: ' + a.slice(0, 40));
  return html.slice(s, e);
};

// ทั้ง 3 ฟังก์ชันอยู่คนละที่ในไฟล์ (canViewTab อยู่เหนือ allowedTabs) ดึงมาต่อกันเอง
const mod = await import('data:text/javascript;base64,' + Buffer.from(
  `const ALL_TABS = ['stock','soldstock','activity','preorder','product','buy','sales','report','gacha','shop'];
let passcode = '', userRole = '', userTabs = [], userShops = [];
`
  + cut('function canViewTab(v) {', 'function toggleNav()')
  + cut('// แถบที่ผู้ใช้ปัจจุบันเข้าได้', '// ซ่อน/แสดงเมนูตามสิทธิ์')
  + cut('// "บัญชีร้านล้วน" =', '// แถบเมนูบัญชีร้าน')
  + `
export { allowedTabs, canViewTab, isShopAccount };
export const login = u => {
  passcode = u.passcode === undefined ? 'x' : u.passcode;
  userRole = u.role || '';
  userTabs = u.tabs || [];
  userShops = u.shops || [];
};
`,
).toString('base64'));

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); } };

console.log('\nผู้ช่วยที่ผูกกับร้าน');

// เคสจริง: tueza5432 — ติ๊กครบ 6 แท็บ และผูกไว้ 3 ร้าน แต่เดิมเห็นแค่เมนูร้านค้า
t('ติ๊กคลังสินค้าไว้ + ผูกร้าน → ต้องเห็นทั้งคลังสินค้าและร้านค้า', () => {
  mod.login({ tabs: ['stock', 'sales', 'report', 'buy', 'product', 'gacha'], shops: ['s1', 's2', 's3'] });
  assert.ok(mod.canViewTab('stock'), 'ติ๊ก stock ไว้ ต้องเห็นคลังสินค้า');
  assert.ok(mod.canViewTab('shop'), 'ผูกร้าน ต้องเห็นเมนูร้านค้า');
});

t('เมนูย่อยของคลังสินค้ามาเองเมื่อติ๊กตัวแม่', () => {
  assert.ok(mod.canViewTab('soldstock'), 'คลังสินค้าขายแล้ว');
  assert.ok(mod.canViewTab('activity'), 'รายงานการใช้งาน');
});

t('แท็บที่ไม่ได้ติ๊ก ยังเข้าไม่ได้', () => {
  assert.ok(!mod.canViewTab('preorder'), 'ไม่ได้ติ๊กพรีออเดอร์');
  assert.ok(!mod.canViewTab('users'), 'ผู้ช่วยห้ามเข้าหน้าผู้ใช้งาน');
  assert.ok(!mod.canViewTab('dashboard'), 'แดชบอร์ดเป็นของแอดมิน/เจ้าของเครื่อง');
});

t('ติ๊กแท็บอื่นไว้ด้วย = ไม่ใช่บัญชีร้านล้วน (ต้องได้เมนูข้างปกติ ไม่ใช่เปลือกร้าน)', () => {
  assert.equal(mod.isShopAccount(), false);
});

// เคสจริง: 25cardmega — ผูกร้านอย่างเดียว ไม่ได้ติ๊กแท็บไหนเลย
t('ผูกร้านอย่างเดียว ไม่ติ๊กอะไร → เห็นแค่เมนูร้านค้า เหมือนเดิมเป๊ะ', () => {
  mod.login({ tabs: [], shops: ['s1'] });
  assert.deepEqual(mod.allowedTabs(), ['shop']);
  assert.ok(!mod.canViewTab('stock'));
  assert.equal(mod.isShopAccount(), true, 'ยังเป็นบัญชีร้านล้วน → เปลือกร้าน + เปิดร้านให้อัตโนมัติ');
});

console.log('\nผู้ช่วยที่ไม่ได้ผูกร้าน (ต้องไม่เปลี่ยนพฤติกรรม)');

t('ติ๊ก stock อย่างเดียว → ได้คลังสินค้า + เมนูย่อย ไม่ได้เมนูร้านค้า', () => {
  mod.login({ tabs: ['stock'], shops: [] });
  assert.deepEqual(mod.allowedTabs(), ['stock']);
  assert.ok(mod.canViewTab('soldstock') && mod.canViewTab('activity'));
  assert.ok(!mod.canViewTab('shop'), 'ไม่ได้ผูกร้าน ไม่ต้องมีเมนูร้านค้า');
  assert.equal(mod.isShopAccount(), false);
});

t('ไม่ติ๊กอะไรเลยและไม่ผูกร้าน → ไม่เห็นอะไรเลย', () => {
  mod.login({ tabs: [], shops: [] });
  assert.deepEqual(mod.allowedTabs(), []);
  assert.ok(!mod.canViewTab('stock'));
});

console.log('\nแอดมิน / เจ้าของเครื่อง (ต้องไม่เปลี่ยนพฤติกรรม)');

t('แอดมินเห็นครบ รวมหน้าผู้ใช้งานและตั้งค่า', () => {
  mod.login({ role: 'admin', tabs: [], shops: [] });
  assert.ok(mod.canViewTab('stock') && mod.canViewTab('users') && mod.canViewTab('settings'));
  assert.ok(mod.canViewTab('dashboard'));
  assert.equal(mod.isShopAccount(), false);
});

t('แอดมินที่ถูกผูกร้านไว้ ก็ยังเห็นครบ ไม่ถูกลดสิทธิ์', () => {
  mod.login({ role: 'admin', tabs: [], shops: ['s1'] });
  assert.ok(mod.canViewTab('stock'));
  assert.equal(mod.isShopAccount(), false);
});

t('เจ้าของเครื่อง (ไม่ล็อกอิน) เห็นทุกแถบ แต่ไม่ใช่หน้าผู้ใช้งาน', () => {
  mod.login({ passcode: '', tabs: [], shops: [] });
  assert.ok(mod.canViewTab('stock') && mod.canViewTab('dashboard'));
  assert.ok(!mod.canViewTab('users'));
  assert.equal(mod.isShopAccount(), false);
});

console.log(`\n${fail ? '✗' : '✓'} ผ่าน ${pass} / ${pass + fail}`);
if (fail) process.exit(1);
