const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../app-core.js');
const Excel = require('../export-excel.js');

class MemoryStorage {
  constructor() { this.values = new Map(); this.failWrites = false; this.failReads = false; }
  getItem(key) { if (this.failReads) throw new Error('Blocked'); return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { if (this.failWrites) throw new Error('Quota exceeded'); this.values.set(key, String(value)); }
}
const stamp = '2026-11-17T12:00:00.000Z';
const make = () => { const storage = new MemoryStorage(); const store = Core.createStore(storage, () => stamp); store.read(); return { storage, store }; };
const input = (extra = {}) => ({ name: 'Marcador', category: 'Oficina', quantity: '8', description: 'Punta fina', ...extra });
const hasCode = code => error => error instanceof Core.InventoryError && error.code === code;

test('los cuatro ejemplos se guardan y suman 245 unidades', () => {
  const { store, storage } = make();
  assert.equal(store.read().products.length, 4);
  assert.equal(Core.stats(store.read().products).units, 245);
  assert.notEqual(storage.getItem(Core.STORAGE_KEY), null);
});
test('agregar limpia espacios y persiste al crear otra instancia', () => {
  const { store, storage } = make();
  const p = store.add(input({ name: '  Marcador   negro  ', category: '  Oficina  ' }));
  const next = Core.createStore(storage).read().products.find(x => x.id === p.id);
  assert.equal(next.name, 'Marcador negro'); assert.equal(next.category, 'Oficina'); assert.equal(next.quantity, 8);
  assert.equal(p.id, 5);
});
test('un nombre vacío no cambia el inventario', () => {
  const { store, storage } = make(); const before = storage.getItem(Core.STORAGE_KEY);
  assert.throws(() => store.add(input({ name: '   ' })), hasCode('VALIDATION'));
  assert.equal(storage.getItem(Core.STORAGE_KEY), before);
});
test('la categoría es obligatoria y se respetan los límites de longitud', () => {
  const { store } = make();
  for (const changed of [{ category: '' }, { name: 'x'.repeat(81) }, { category: 'x'.repeat(51) }, { description: 'x'.repeat(501) }]) {
    assert.throws(() => store.add(input(changed)), hasCode('VALIDATION'));
  }
});
for (const quantity of ['', ' ', '-1', '1.5', 'texto', '1000000', Infinity, null, undefined, true, [], {}]) {
  test('rechaza una cantidad inválida: ' + String(quantity) + ' (' + typeof quantity + ')', () => {
    const { store } = make();
    assert.throws(() => store.add(input({ quantity })), hasCode('VALIDATION'));
    assert.equal(store.read().products.length, 4);
  });
}
test('cero es válido y se clasifica como agotado', () => {
  const { store } = make(); const p = store.add(input({ quantity: '0' }));
  assert.equal(p.quantity, 0); assert.equal(Core.status(p.quantity), 'Agotado');
});
test('detecta duplicados sin distinguir mayúsculas, acentos ni espacios', () => {
  const { store } = make();
  assert.throws(() => store.add(input({ name: '  LAPIZ ', category: ' PAPELERIA ' })), hasCode('VALIDATION'));
  assert.equal(store.read().products.length, 4);
});
test('un mismo nombre en otra categoría se conserva como otro producto', () => {
  const { store } = make(); const p = store.add(input({ name: 'Lápiz', category: 'Oficina' }));
  assert.equal(p.id, 5);
});
test('modificar conserva el ID, actualiza datos y persiste', () => {
  const { store, storage } = make(); const old = store.read().products[0];
  store.update(old.id, { ...old, quantity: '9', description: 'Actualizado' }, old.version);
  const p = Core.createStore(storage).read().products.find(p => p.id === old.id);
  assert.equal(p.quantity, 9); assert.equal(p.version, 2); assert.equal(p.description, 'Actualizado');
});
test('no permite modificar un producto para duplicar otro', () => {
  const { store } = make();
  assert.throws(() => store.update(1, input({ name: 'Cuaderno', category: 'Papelería' }), 1), hasCode('VALIDATION'));
  assert.equal(store.read().products[0].name, 'Lápiz');
});
test('eliminar todos persiste vacío y no vuelve a insertar ejemplos', () => {
  const { store, storage } = make();
  store.read().products.forEach(p => store.remove(p.id, p.version));
  assert.deepEqual(Core.createStore(storage).read().products, []);
  assert.equal(store.add(input()).id, 5);
});
test('deshacer recupera el mismo ID', () => {
  const { store } = make(); const removed = store.remove(2, 1); const restored = store.restore(removed);
  assert.equal(restored.id, 2); assert.equal(store.read().products.length, 4);
});
test('deshacer no sobrescribe un nuevo producto con el mismo nombre', () => {
  const { store } = make(); const removed = store.remove(1, 1);
  store.add({ ...removed });
  assert.throws(() => store.restore(removed), hasCode('VALIDATION'));
  assert.equal(store.read().products.length, 4);
});
test('una edición de otra pestaña no se sobrescribe con datos antiguos', () => {
  const { store, storage } = make(); const old = store.read().products[0];
  const other = Core.createStore(storage); other.update(old.id, { ...old, quantity: '3' }, old.version);
  assert.throws(() => store.update(old.id, { ...old, quantity: '99' }, old.version), hasCode('CONFLICT'));
  assert.equal(store.read().products[0].quantity, 3);
});
test('un registro eliminado en otra pestaña no se vuelve a crear al editar', () => {
  const { store } = make(); const old = store.read().products[0]; store.remove(old.id, old.version);
  assert.throws(() => store.update(old.id, old, old.version), hasCode('NOT_FOUND'));
});
test('un error de guardado conserva los datos anteriores', () => {
  const { store, storage } = make(); const before = storage.getItem(Core.STORAGE_KEY);
  storage.failWrites = true;
  assert.throws(() => store.add(input()), hasCode('SAVE'));
  assert.equal(storage.getItem(Core.STORAGE_KEY), before);
});
test('informa cuando el navegador bloquea el almacenamiento', () => {
  const storage = new MemoryStorage(); storage.failReads = true;
  assert.throws(() => Core.createStore(storage).read(), hasCode('ACCESS'));
});
test('datos dañados no se sustituyen sin autorización', () => {
  const storage = new MemoryStorage(); storage.setItem(Core.STORAGE_KEY, '{incorrecto');
  assert.throws(() => Core.createStore(storage).read(), hasCode('CORRUPT'));
  assert.equal(storage.getItem(Core.STORAGE_KEY), '{incorrecto');
});
test('también detecta productos con una estructura inválida', () => {
  const { store, storage } = make(); const state = store.read(); state.products[0].quantity = -2;
  storage.setItem(Core.STORAGE_KEY, JSON.stringify(state));
  assert.throws(() => store.read(), hasCode('CORRUPT'));
});
test('los filtros distinguen 0, pocas existencias y disponibilidad normal', () => {
  const { store } = make();
  const a = store.read().products[0], b = store.read().products[1];
  store.update(a.id, { ...a, quantity: 0 }, a.version); store.update(b.id, { ...b, quantity: 10 }, b.version);
  const p = store.read().products;
  assert.equal(Core.filterProducts(p, { stock: 'out' }).length, 1);
  assert.equal(Core.filterProducts(p, { stock: 'low' }).length, 1);
  assert.equal(Core.filterProducts(p, { search: 'lapiz' })[0].name, 'Lápiz');
  assert.equal(Core.filterProducts(p, { search: 'inexistente' }).length, 0);
});
test('el reporte es un ZIP XLSX real con texto seguro para Excel', () => {
  const { store } = make(); store.add(input({ name: '=SUM(A1:A2)', description: '<texto> & acentos: á' }));
  const bytes = Excel.workbook(store.read().products);
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50);
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.includes('[Content_Types].xml')); assert.ok(text.includes('xl/worksheets/sheet1.xml'));
  assert.ok(text.includes('t="inlineStr"')); assert.ok(text.includes('&lt;texto&gt; &amp;'));
  assert.ok(!text.includes('<f>'));
});
