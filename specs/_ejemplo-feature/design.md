# Diseño — Feature: Alta de cliente (EJEMPLO)

## Decisiones técnicas
- Se añade el formulario de alta en la pantalla de clientes.
- La validación (campos obligatorios, email único) se hace en el backend, no solo en
  el navegador (no fiarse solo del frontend).

## Ficheros a crear / tocar
- (crear) endpoint/función "crearCliente" en el backend.
- (tocar) la pantalla de listado de clientes: añadir botón y formulario.
- (crear) tests del alta de cliente.

## Ficheros que NO se tocan
- La lógica de contratos (fuera de alcance de esta feature).

## Alternativas consideradas
- Validar solo en el navegador → descartado: inseguro, se puede saltar.
