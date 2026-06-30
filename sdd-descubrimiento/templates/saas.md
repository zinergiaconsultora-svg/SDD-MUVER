# Plantilla de Descubrimiento: SaaS (Software as a Service)

Esta plantilla guía la entrevista cuando se está definiendo un producto de tipo SaaS o plataforma multi-inquilino.

## 🔑 Preguntas de Choque (Para el Analista)

### 1. Planes y Límites
- ¿Qué planes de suscripción existirán (ej: Free, Pro, Enterprise)?
- ¿Cuáles son los límites cuantitativos de cada plan (ej: número de proyectos, espacio de disco, llamadas a la API)?

### 2. Multi-inquilino (Multi-tenant) e Inquilino Único
- ¿Los usuarios comparten la misma base de datos con aislamiento lógico, o requiere bases de datos aisladas físicamente?
- ¿Existen "Organizaciones" o "Equipos" donde varios usuarios colaboren bajo una misma suscripción?

### 3. Pasarela de Pago
- ¿Qué pasarela de pagos se usará (Stripe, PayPal, MercadoPago)?
- ¿Se manejarán cobros recurrentes (suscripciones), pagos únicos de uso o cobros por volumen de uso?

---

## 🗄️ Modelo de Datos Sugerido (Invariantes)

### Entidad: `Tenant` / `Organization`
```json
{
  "id": "uuid",
  "name": "string",
  "plan": "free | pro | enterprise",
  "status": "active | trialing | past_due | canceled",
  "stripeCustomerId": "string (opcional)",
  "createdAt": "timestamp"
}
```

### Entidad: `Subscription`
```json
{
  "id": "uuid",
  "tenantId": "uuid",
  "status": "active | canceled | incomplete",
  "currentPeriodEnd": "timestamp",
  "cancelAtPeriodEnd": "boolean"
}
```
