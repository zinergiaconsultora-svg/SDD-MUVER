# La Constitución del Proyecto

Este documento define la ley fundamental del sistema. Contiene las reglas lógicas, invariantes de negocio y estructuras de datos inmutables que **todos** los agentes y desarrolladores deben respetar de forma absoluta.

---

## 1. Invariantes y Reglas Lógicas de Negocio
*Define aquí las leyes inmutables del negocio que ningún flujo de código puede violar.*
- **Ejemplo 1 (SaaS):** Un usuario no puede tener más de una suscripción activa de forma simultánea.
- **Ejemplo 2 (Fintech):** El balance de una cuenta nunca puede ser menor que el límite de sobregiro establecido (`Balance >= -Sobregiro`).
- **Ejemplo 3 (E-Commerce):** Un pedido no puede ser marcado como "Enviado" si su estado de pago no es "Pagado".

---

## 2. Esquemas de Datos e Interfaces Fundamentales
*Define la estructura JSON o TypeScript de las entidades clave para garantizar consistencia semántica en los datos.*

### Entidad: Usuario
```json
{
  "id": "uuid",
  "email": "string (email)",
  "role": "admin | editor | viewer",
  "createdAt": "ISO8601 Timestamp"
}
```

---

## 3. Principio de No-Regresión de Reglas
- Cualquier nueva especificación en `specs/` que contradiga o anule una regla de esta Constitución será rechazada inmediatamente por el `spec_author`.
- Para modificar una regla constitucional, el usuario debe autorizarlo y modificar este archivo de forma explícita primero.
