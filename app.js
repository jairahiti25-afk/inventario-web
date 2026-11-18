/* Interfaz de Ribera. Las reglas de los productos están en app-core.js. */
(function () {
  'use strict';
  const Core = window.InventarioCore;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const page = document.body.dataset.page;
  const number = value => new Intl.NumberFormat('es-MX').format(value);
  let store, state = null, editing = null, deleting = null, lastDeleted = null;
  let busy = false, toastTimer = null;
  const form = $('#product-form');

  function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon'); svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + name); svg.append(use); return svg;
  }
  function badge(quantity) {
    return el('span', 'stock-badge ' + (quantity === 0 ? 'out' : quantity <= 10 ? 'low' : 'available'), Core.status(quantity));
  }
  function message(text, undo) {
    clearTimeout(toastTimer);
    $('#toast-message').textContent = text;
    $('#undo-delete').hidden = !undo;
    $('#toast').hidden = false;
    toastTimer = setTimeout(closeToast, undo ? 18000 : 6000);
  }
  function closeToast() {
    $('#toast').hidden = true; lastDeleted = null; clearTimeout(toastTimer);
  }
  function showStorageError(error) {
    $('#storage-error').hidden = false;
    $('#storage-error-text').textContent = error.message;
    $('#download-raw').hidden = error.code !== 'CORRUPT';
    $('#open-reset').hidden = error.code !== 'CORRUPT';
    $('#save-status').textContent = 'Guardado no disponible';
    $$('[data-export]').forEach(button => button.disabled = true);
    if (form) $('#product-fields').disabled = true;
  }
  function readState() { state = store.read(); return state; }

  function categories() {
    const groups = new Map();
    for (const product of state.products) {
      const key = Core.normalize(product.category);
      if (!groups.has(key)) groups.set(key, { name: product.category, count: 0, units: 0 });
      const group = groups.get(key); group.count++; group.units += product.quantity;
    }
    return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }
  function renderCategories() {
    const groups = categories(); const filter = $('#category-filter');
    if (filter) {
      const current = filter.value;
      filter.replaceChildren(new Option('Todas', ''));
      groups.forEach(group => filter.add(new Option(group.name, group.name)));
      const previous = groups.find(group => Core.normalize(group.name) === Core.normalize(current));
      filter.value = previous ? previous.name : '';
    }
    const list = $('#categories');
    if (list) {
      const names = new Map(['Papelería', 'Oficina', 'Escolar', 'Otros'].map(name => [Core.normalize(name), name]));
      groups.forEach(group => names.set(Core.normalize(group.name), group.name));
      list.replaceChildren(...Array.from(names.values()).map(name => new Option(name)));
    }
    const breakdown = $('#category-breakdown');
    if (breakdown) {
      breakdown.replaceChildren();
      groups.forEach(group => {
        const row = el('div', 'category-row'); const label = el('div');
        label.append(el('span', '', group.name), el('strong', '', group.count + (group.count === 1 ? ' producto' : ' productos')));
        const bar = el('div', 'category-bar'); const fill = el('span');
        fill.style.width = (group.count / Math.max(1, state.products.length) * 100) + '%';
        bar.append(fill); row.append(label, bar, el('small', '', number(group.units) + ' unidades')); breakdown.append(row);
      });
      if (!groups.length) breakdown.append(el('p', 'category-empty', 'Las categorías aparecerán cuando agregues productos.'));
    }
  }

  function productCell(product) {
    const cell = el('td'); const content = el('div', 'product-cell');
    const symbol = el('span', 'product-symbol', product.name.slice(0, 1).toLocaleUpperCase('es'));
    symbol.setAttribute('aria-hidden', 'true');
    const text = el('div'); text.append(el('strong', 'product-name', product.name));
    const details = Core.code(product.id) + (product.description ? ' · ' + product.description : '');
    const meta = el('p', 'product-meta', details); meta.title = details;
    text.append(meta); content.append(symbol, text); cell.append(content); return cell;
  }
  function row(product) {
    const tr = el('tr'); tr.append(productCell(product));
    if (page !== 'dashboard') { const td = el('td'); td.append(el('span', 'category-chip', product.category)); tr.append(td); }
    const quantity = el('td'); quantity.append(el('span', 'quantity-value', number(product.quantity)), el('span', 'quantity-unit', 'u.'));
    const status = el('td'); status.append(badge(product.quantity)); tr.append(quantity, status);
    if (page !== 'dashboard') {
      const td = el('td'); const actions = el('div', 'row-actions');
      const edit = el('a', 'row-action'); edit.href = 'agregar.html?id=' + product.id;
      edit.setAttribute('aria-label', 'Editar ' + product.name); edit.title = 'Editar producto'; edit.append(icon('edit'), el('span', '', 'Editar'));
      const remove = el('button', 'row-action delete'); remove.type = 'button'; remove.dataset.delete = product.id;
      remove.setAttribute('aria-label', 'Eliminar ' + product.name); remove.title = 'Eliminar producto'; remove.append(icon('trash'), el('span', '', 'Eliminar'));
      actions.append(edit, remove); td.append(actions); tr.append(td);
    }
    const labels = page === 'dashboard' ? ['Producto', 'Existencias', 'Estado'] : ['Producto', 'Categoría', 'Existencias', 'Estado', 'Acciones'];
    tr.setAttribute('role', 'row');
    Array.from(tr.cells).forEach((cell, index) => {
      cell.dataset.label = labels[index];
      cell.setAttribute('role', 'cell');
    });
    return tr;
  }
  function renderTable() {
    const body = $('#inventory-body'); if (!body) return;
    const dashboard = page === 'dashboard';
    const options = dashboard ? { sort: 'recent' } : { search: $('#search').value, category: $('#category-filter').value, stock: $('#stock-filter').value, sort: $('#sort').value };
    let products = Core.filterProducts(state.products, options);
    if (dashboard) products = products.slice(0, 5);
    body.replaceChildren(...products.map(row));
    const empty = products.length === 0;
    $('#empty-state').hidden = !empty;
    body.closest('.table-scroll').hidden = empty;
    if (empty) {
      const filtered = state.products.length > 0;
      $('#empty-title').textContent = filtered ? 'Sin coincidencias' : 'El inventario está vacío';
      $('#empty-copy').textContent = filtered ? 'Prueba otra búsqueda o limpia los filtros.' : 'Agrega tu primer producto para comenzar.';
      $('#empty-add').hidden = filtered;
      $('#clear-filters').hidden = !filtered;
    }
    if ($('#result-count')) $('#result-count').textContent = products.length + (products.length === 1 ? ' producto encontrado' : ' productos encontrados');
    if ($('#recent-count')) $('#recent-count').textContent = products.length + (products.length === 1 ? ' producto' : ' productos');
  }
  function render() {
    const totals = Core.stats(state.products);
    $$('[data-stat]').forEach(element => element.textContent = number(totals[element.dataset.stat]));
    $('#nav-count').textContent = number(totals.products);
    if ($('#total-count')) $('#total-count').textContent = number(totals.products);
    if ($('#units-summary')) $('#units-summary').textContent = number(totals.units) + ' unidades en total';
    $$('[data-export]').forEach(button => button.disabled = !totals.products);
    renderCategories(); renderTable();
  }

  function clearFormErrors() {
    if (!form) return;
    $('#form-error').hidden = true; $('#reload-product').hidden = true;
    for (const field of ['name', 'category', 'quantity', 'description']) {
      $('#error-' + field).textContent = ''; form.elements.namedItem(field).removeAttribute('aria-invalid');
    }
  }
  function formError(error) {
    $('#form-error').hidden = false; $('#form-error').textContent = error.message;
    for (const [key, text] of Object.entries(error.fields || {})) {
      $('#error-' + key).textContent = text; form.elements.namedItem(key).setAttribute('aria-invalid', 'true');
    }
    const first = Object.keys(error.fields || {})[0];
    if (first) form.elements.namedItem(first).focus();
    $('#reload-product').hidden = error.code !== 'CONFLICT';
    if (error.code === 'NOT_FOUND') $('#save-product').disabled = true;
  }
  function preview() {
    if (!form) return;
    const data = Object.fromEntries(new FormData(form));
    $('#preview-name').textContent = data.name?.trim() || 'Nombre del producto';
    $('#preview-category').textContent = data.category?.trim() || 'Sin categoría';
    $('#preview-description').textContent = data.description?.trim() || 'Los detalles de tu producto aparecerán aquí.';
    $('#description-count').textContent = (data.description || '').length + ' / 500';
    const quantity = data.quantity === '' ? NaN : Number(data.quantity);
    const valid = Number.isSafeInteger(quantity) && quantity >= 0 && quantity <= Core.MAX_QUANTITY;
    $('#preview-quantity').textContent = valid ? number(quantity) : '—';
    const oldBadge = $('#preview-status');
    const nextBadge = valid ? badge(quantity) : el('span', 'stock-badge neutral', 'Por definir');
    nextBadge.id = 'preview-status'; oldBadge.replaceWith(nextBadge);
  }
  function setupForm() {
    if (!form) return;
    clearFormErrors(); $('#product-fields').disabled = false; $('#save-product').disabled = false;
    const idValue = new URLSearchParams(location.search).get('id');
    if (idValue !== null) {
      const id = Number(idValue);
      editing = state.products.find(product => product.id === id && Number.isSafeInteger(id) && id > 0);
      if (!editing) {
        formError(new Core.InventoryError('NOT_FOUND', 'No se encontró el producto solicitado. Vuelve a Productos para seleccionar un registro.'));
        $('#product-fields').disabled = true; return;
      }
      for (const field of ['name', 'category', 'quantity', 'description']) form.elements.namedItem(field).value = editing[field];
      $('#page-title').textContent = 'Modificar producto'; $('#page-eyebrow').textContent = 'EDICIÓN DE ' + Core.code(editing.id);
      $('.topbar strong').textContent = 'Modificar producto';
      $('#page-subtitle').textContent = 'Actualiza la información y guarda tus cambios.';
      $('#form-title').textContent = 'Información de ' + Core.code(editing.id);
      $('#save-product span').textContent = 'Guardar cambios'; document.title = 'Modificar producto · Ribera';
    }
    preview();
  }
  function initialize() {
    try {
      if (!store) store = Core.createStore(window.localStorage);
      readState(); $('#storage-error').hidden = true; $('#save-status').textContent = 'Guardado en este navegador';
      render(); setupForm();
    } catch (error) {
      showStorageError(error instanceof Core.InventoryError ? error : new Core.InventoryError('ACCESS', 'Este navegador no permite guardar los datos. Revisa sus permisos y vuelve a intentarlo.'));
    }
  }

  if (form) {
    form.addEventListener('input', event => {
      const name = event.target.name;
      if (['name', 'category', 'quantity', 'description'].includes(name)) {
        $('#error-' + name).textContent = ''; event.target.removeAttribute('aria-invalid'); preview();
      }
    });
    form.addEventListener('submit', event => {
      event.preventDefault(); if (busy || !state) return;
      busy = true; $('#save-product').disabled = true; clearFormErrors();
      try {
        const input = Object.fromEntries(new FormData(form));
        const product = editing ? store.update(editing.id, input, editing.version) : store.add(input);
        const next = new URL('productos.html', location.href);
        next.searchParams.set(editing ? 'actualizado' : 'guardado', product.id);
        location.href = next.href;
      } catch (error) { busy = false; $('#save-product').disabled = false; formError(error); }
    });
    $('#reload-product').addEventListener('click', () => location.reload());
  }

  for (const id of ['search', 'category-filter', 'stock-filter', 'sort']) {
    const field = $('#' + id); if (field) field.addEventListener(id === 'search' ? 'input' : 'change', () => state && renderTable());
  }
  $('#clear-filters')?.addEventListener('click', () => {
    $('#search').value = ''; $('#category-filter').value = ''; $('#stock-filter').value = ''; $('#sort').value = 'name';
    renderTable(); $('#search').focus();
  });

  // La eliminación utiliza la versión que se confirmó en el diálogo.
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-delete]'); if (!button) return;
    try {
      readState(); const product = state.products.find(p => p.id === Number(button.dataset.delete));
      if (!product) { render(); message('El producto ya no está en la lista.'); return; }
      deleting = { id: product.id, version: product.version };
      $('#delete-copy').textContent = '¿Quieres eliminar “' + product.name + '” del inventario?';
      $('#delete-error').hidden = true; $('#confirm-delete').disabled = false; $('#delete-dialog').showModal();
    } catch (error) { showStorageError(error); }
  });
  $('#cancel-delete').addEventListener('click', () => $('#delete-dialog').close());
  $('#delete-dialog').addEventListener('close', () => { deleting = null; });
  $('#confirm-delete').addEventListener('click', () => {
    if (!deleting) return; $('#confirm-delete').disabled = true;
    try {
      const removed = store.remove(deleting.id, deleting.version);
      lastDeleted = removed; $('#delete-dialog').close(); readState(); render();
      message('Se eliminó “' + removed.name + '”.', true);
    } catch (error) {
      $('#confirm-delete').disabled = false; $('#delete-error').textContent = error.message; $('#delete-error').hidden = false;
    }
  });
  $('#undo-delete').addEventListener('click', () => {
    if (!lastDeleted) return;
    try { const restored = store.restore(lastDeleted); lastDeleted = null; readState(); render(); message('Se recuperó “' + restored.name + '”.'); }
    catch (error) { message(error.message); }
  });
  $('#close-toast').addEventListener('click', closeToast);

  $$('[data-export]').forEach(button => button.addEventListener('click', () => {
    try {
      readState(); if (!state.products.length) { message('No hay productos para exportar.'); return; }
      window.InventarioExcel.download(Core.filterProducts(state.products, { sort: 'name' }));
      message('Se descargó el inventario completo en Excel.');
    } catch (error) { message(error.message || 'No se pudo generar el reporte. Vuelve a intentarlo.'); }
  }));
  $('#retry-storage').addEventListener('click', initialize);
  $('#download-raw').addEventListener('click', () => {
    try {
      const text = store.raw();
      const url = URL.createObjectURL(new Blob([text || ''], { type: 'text/plain;charset=utf-8' }));
      const link = el('a'); link.href = url; link.download = 'copia_datos_inventario.txt';
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) { message(error.message); }
  });
  $('#open-reset').addEventListener('click', () => { $('#reset-error').hidden = true; $('#reset-dialog').showModal(); });
  $('#cancel-reset').addEventListener('click', () => $('#reset-dialog').close());
  $('#confirm-reset').addEventListener('click', () => {
    try { store.reset(); $('#reset-dialog').close(); initialize(); message('Se restablecieron los cuatro productos de ejemplo.'); }
    catch (error) { $('#reset-error').textContent = error.message; $('#reset-error').hidden = false; }
  });

  window.addEventListener('storage', event => {
    if (event.key !== Core.STORAGE_KEY && event.key !== null) return;
    try {
      readState(); render();
      if (form && editing) {
        const current = state.products.find(p => p.id === editing.id);
        if (!current) formError(new Core.InventoryError('NOT_FOUND', 'Este producto se eliminó en otra pestaña. Vuelve al inventario.'));
        else if (current.version !== editing.version) formError(new Core.InventoryError('CONFLICT', 'El producto cambió en otra pestaña. Recarga sus datos antes de guardar.'));
      }
    } catch (error) { showStorageError(error); }
  });

  $('#current-date').textContent = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
  initialize();
  if (page === 'products' && state) {
    const query = new URLSearchParams(location.search); const saved = query.get('guardado'); const updated = query.get('actualizado');
    const product = state.products.find(p => p.id === Number(saved || updated));
    if (product && (saved || updated)) {
      message((updated ? 'Se actualizó “' : 'Se guardó “') + product.name + '”.');
      history.replaceState(null, '', location.pathname);
    }
  }
})();
