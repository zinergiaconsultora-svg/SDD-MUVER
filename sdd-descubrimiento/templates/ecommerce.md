# Plantilla de Descubrimiento: E-Commerce (Comercio Electrónico)

Esta plantilla guía la entrevista al estructurar una tienda online o catálogo con carrito de compras y pasarela de pago.

## 🔑 Preguntas de Choque (Para el Analista)

### 1. Gestión de Inventario
- ¿Qué pasa si un usuario intenta comprar un producto del cual no queda stock físico? ¿Se permite la venta en preventa o se bloquea el botón?
- ¿Se manejan variaciones de producto (talla, color, material) y cada una tiene su propio inventario independiente?

### 2. Impuestos y Envío
- ¿Cómo se calculan los gastos de envío (tasa fija, según el peso, integración dinámica con transportistas)?
- ¿Los precios mostrados en la web incluyen impuestos (IVA) o se calculan en el checkout?

### 3. Estados del Pedido
- ¿Cuál es el ciclo de vida exacto de un pedido? (ej: `creado` -> `pagado` -> `preparando` -> `enviado` -> `entregado` -> `devuelto`).

---

## 🗄️ Modelo de Datos Sugerido (Invariantes)

### Entidad: `Product`
```json
{
  "id": "uuid",
  "name": "string",
  "price": "decimal",
  "stock": "integer (>= 0)",
  "variants": "array of variant objects"
}
```

### Entidad: `Order`
```json
{
  "id": "uuid",
  "userId": "uuid (opcional)",
  "items": "array of order items (productId, quantity, price)",
  "totalPrice": "decimal",
  "paymentStatus": "pending | paid | failed | refunded",
  "shippingStatus": "unshipped | processing | shipped | delivered",
  "createdAt": "timestamp"
}
```
