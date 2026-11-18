# Ribera · Inventario

Versión de la actividad 4.4 para el repositorio `jairahiti25-afk/inventario-web`.

## Qué permite hacer

- Guardar productos y conservarlos al recargar.
- Editar nombre, categoría, cantidad y descripción.
- Eliminar con confirmación y deshacer el último borrado.
- Buscar, filtrar y ordenar el catálogo.
- Exportar todo el inventario en un archivo Excel `.xlsx`.

Se rechazan campos obligatorios vacíos, cantidades negativas o decimales y productos repetidos en la misma categoría. La cantidad 0 es válida. Si el navegador no permite guardar, se muestra el error y no se anuncia un guardado que no ocurrió.

## Diseño

Paleta verde lago, navegación lateral y superficies claras. Los campos usan letra de 16 px; los botones de acción tienen un área de al menos 46 px de alto. En celular y tableta los productos se muestran en tarjetas. El formulario coloca primero los campos en pantallas pequeñas y mantiene la vista previa disponible.

## Abrir y publicar

En XAMPP: copiar los archivos en `C:\xampp\htdocs\inventario-web`, iniciar Apache y abrir `http://localhost/inventario-web/`.

En GitHub: los archivos HTML, CSS y JavaScript deben quedar directamente en la raíz de `main`. En Settings > Pages, usar Deploy from a branch > main > /(root).

## Guardado

Los datos se guardan en `localStorage`. Pertenecen al navegador y a la dirección de la página. No se sincronizan entre dispositivos. Si se borran los datos del navegador, se elimina ese inventario; el archivo Excel sirve como una copia de consulta.

La primera visita carga cuatro productos de ejemplo. Al eliminar todos, el inventario permanece vacío. Los datos dañados no se sustituyen automáticamente, y una edición antigua no sobrescribe cambios de otra pestaña.

## Archivos

- `index.html`: panel de existencias.
- `productos.html`: catálogo y acciones.
- `agregar.html`: captura y edición.
- `style.css`: diseño adaptable.
- `app-core.js`: validación y guardado.
- `app.js`: interfaz.
- `export-excel.js`: generación de Excel sin servicios externos.

Las reglas se comprueban con `node --test tests/inventario.test.cjs`.
