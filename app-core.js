/* Datos y reglas del inventario. No depende de la interfaz. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.InventarioCore = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const STORAGE_KEY = 'inventario-web.ribera.v1';
  const MAX_QUANTITY = 999999;
  const clone = value => JSON.parse(JSON.stringify(value));
  const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').replace(/\s+/g, ' ').trim();
  const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

  class InventoryError extends Error {
    constructor(code, message, fields) {
      super(message); this.name = 'InventoryError'; this.code = code; this.fields = fields || {};
    }
  }

  function initialState(now) {
    const names = ['Lápiz', 'Cuaderno', 'Borrador', 'Regla'];
    const quantities = [120, 50, 35, 40];
    const descriptions = ['Lápiz de grafito para uso diario.', 'Cuaderno de notas.', 'Borrador escolar.', 'Regla de 30 centímetros.'];
    return {
      schema: 1, revision: 0, nextId: 5, updatedAt: now,
      products: names.map((name, i) => ({
        id: i + 1, name, category: 'Papelería', description: descriptions[i], quantity: quantities[i],
        version: 1, createdAt: now, updatedAt: now
      }))
    };
  }

  // La misma validación se aplica al agregar, modificar y recuperar un producto.
  function validateProduct(input, products, currentId) {
    input = input || {};
    const value = {
      name: clean(input.name), category: clean(input.category),
      description: typeof input.description === 'string' ? input.description.trim() : '',
      quantity: Number(input.quantity)
    };
    const errors = {};
    if (!value.name) errors.name = 'Escribe el nombre del producto.';
    else if (value.name.length > 80) errors.name = 'Usa un nombre de hasta 80 caracteres.';
    if (!value.category) errors.category = 'Indica una categoría.';
    else if (value.category.length > 50) errors.category = 'La categoría puede tener hasta 50 caracteres.';
    if (value.description.length > 500) errors.description = 'La descripción puede tener hasta 500 caracteres.';
    const raw = input.quantity;
    if (!['number', 'string'].includes(typeof raw) || (typeof raw === 'string' && !raw.trim())) {
      errors.quantity = 'Indica la cantidad. Puedes escribir 0 si está agotado.';
    } else if (!Number.isSafeInteger(value.quantity) || value.quantity < 0 || value.quantity > MAX_QUANTITY) {
      errors.quantity = 'Escribe un número entero entre 0 y 999999.';
    }
    if (value.name && value.category && (products || []).some(p => p.id !== currentId && normalize(p.name) === normalize(value.name) && normalize(p.category) === normalize(value.category))) {
      errors.name = 'Ya existe ese producto en esta categoría. Puedes modificar su cantidad desde Productos.';
    }
    return { value, errors, valid: Object.keys(errors).length === 0 };
  }

  function assertState(state) {
    if (!state || state.schema !== 1 || !Array.isArray(state.products) || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Number.isSafeInteger(state.nextId) || state.nextId < 1) throw new Error('Formato incorrecto');
    const ids = new Set(); const names = new Set();
    for (const p of state.products) {
      if (!p || !Number.isSafeInteger(p.id) || p.id < 1 || ids.has(p.id) || p.id >= state.nextId || !Number.isSafeInteger(p.version) || p.version < 1) throw new Error('Identificador incorrecto');
      const valid = validateProduct(p, [], p.id);
      if (!valid.valid || typeof p.quantity !== 'number' || ![p.name, p.category, p.description].every(t => typeof t === 'string') || ![p.createdAt, p.updatedAt].every(t => typeof t === 'string' && Number.isFinite(Date.parse(t)))) throw new Error('Producto incorrecto');
      const key = normalize(p.name) + '\u0000' + normalize(p.category);
      if (names.has(key)) throw new Error('Producto repetido');
      ids.add(p.id); names.add(key);
    }
    return state;
  }

  function createStore(storage, clock) {
    const now = clock || (() => new Date().toISOString());
    function raw() {
      try { return storage.getItem(STORAGE_KEY); }
      catch (_) { throw new InventoryError('ACCESS', 'No se pudo acceder al almacenamiento de este navegador. Revisa sus permisos y vuelve a intentarlo.'); }
    }
    function write(state) {
      try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); }
      catch (_) { throw new InventoryError('SAVE', 'No se pudo guardar el cambio. Tus datos anteriores se conservaron. Revisa el espacio disponible y los permisos del navegador.'); }
    }
    function read() {
      const text = raw();
      if (text === null) { const state = initialState(now()); write(state); return state; }
      try { return assertState(JSON.parse(text)); }
      catch (_) { throw new InventoryError('CORRUPT', 'No se pudieron leer los datos guardados. Descarga una copia antes de restablecer los ejemplos.'); }
    }
    function validate(input, state, id) {
      const checked = validateProduct(input, state.products, id);
      if (!checked.valid) throw new InventoryError('VALIDATION', 'Revisa los campos indicados.', checked.errors);
      return checked.value;
    }
    function find(state, id, expectedVersion) {
      const product = state.products.find(p => p.id === id);
      if (!product) throw new InventoryError('NOT_FOUND', 'Este producto ya no existe. Vuelve al inventario para revisar la lista.');
      if (expectedVersion !== undefined && product.version !== expectedVersion) throw new InventoryError('CONFLICT', 'El producto cambió en otra pestaña. Recarga sus datos antes de volver a guardar.');
      return product;
    }
    // Primero se prepara el cambio; solo se informa éxito si setItem lo guarda.
    function change(operation) {
      const state = read(); const stamp = now();
      const result = operation(state, stamp);
      state.revision += 1; state.updatedAt = stamp;
      write(state);
      return clone(result);
    }
    return {
      read, raw,
      add(input) {
        return change((state, stamp) => {
          if (state.nextId >= Number.MAX_SAFE_INTEGER) throw new InventoryError('LIMIT', 'No se pudo asignar otro identificador al producto.');
          const value = validate(input, state);
          const product = { ...value, id: state.nextId, version: 1, createdAt: stamp, updatedAt: stamp };
          state.nextId += 1; state.products.push(product); return product;
        });
      },
      update(id, input, expectedVersion) {
        return change((state, stamp) => {
          const product = find(state, id, expectedVersion);
          Object.assign(product, validate(input, state, id), { version: product.version + 1, updatedAt: stamp });
          return product;
        });
      },
      remove(id, expectedVersion) {
        return change(state => {
          const product = find(state, id, expectedVersion);
          state.products = state.products.filter(p => p.id !== id); return product;
        });
      },
      restore(product) {
        return change((state, stamp) => {
          if (state.products.some(p => p.id === product.id)) throw new InventoryError('CONFLICT', 'El producto ya está en el inventario.');
          validate(product, state);
          const restored = { ...clone(product), version: product.version + 1, updatedAt: stamp };
          state.nextId = Math.max(state.nextId, restored.id + 1);
          state.products.push(restored); return restored;
        });
      },
      reset() { const state = initialState(now()); write(state); return clone(state); }
    };
  }

  function status(quantity) { return quantity === 0 ? 'Agotado' : quantity <= 10 ? 'Pocas existencias' : 'Disponible'; }
  function stats(products) {
    return {
      products: products.length,
      units: products.reduce((sum, p) => sum + p.quantity, 0),
      low: products.filter(p => p.quantity > 0 && p.quantity <= 10).length,
      out: products.filter(p => p.quantity === 0).length
    };
  }
  function filterProducts(products, options) {
    options = options || {}; const term = normalize(options.search || '');
    const result = products.filter(p => {
      const matchesText = !term || normalize([p.name, p.category, p.description, code(p.id)].join(' ')).includes(term);
      const matchesCategory = !options.category || normalize(p.category) === normalize(options.category);
      const matchesStock = !options.stock || (options.stock === 'low' && p.quantity > 0 && p.quantity <= 10) || (options.stock === 'out' && p.quantity === 0);
      return matchesText && matchesCategory && matchesStock;
    });
    result.sort(options.sort === 'recent' ? (a, b) => b.id - a.id : options.sort === 'quantity' ? (a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name, 'es') : (a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) || a.id - b.id);
    return result;
  }
  function code(id) { return 'P' + String(id).padStart(3, '0'); }
  return { STORAGE_KEY, MAX_QUANTITY, InventoryError, normalize, initialState, validateProduct, assertState, createStore, status, stats, filterProducts, code };
});
