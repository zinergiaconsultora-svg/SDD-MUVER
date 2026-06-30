# Plantilla de Descubrimiento: API & Backend Services

Esta plantilla guía el análisis al diseñar una API REST, GraphQL o servicios de procesamiento en segundo plano.

## 🔑 Preguntas de Choque (Para el Analista)

### 1. Autenticación y Autorización
- ¿Cómo se autenticarán los clientes de la API (Tokens JWT, API Keys estáticas, OAuth2)?
- ¿Qué niveles de acceso (RBAC o ABAC) existen y cómo se validarán en los controladores?

### 2. Rate Limiting y Cuotas
- ¿Existe algún límite de peticiones por minuto/hora para evitar abusos o denegación de servicio (DoS)?
- ¿Cuáles son los códigos de error estándar en caso de rebasar los límites (ej: HTTP 429 Too Many Requests)?

### 3. Integración y Webhooks
- ¿La API necesita enviar eventos a servicios externos (Webhooks)? En ese caso, ¿cómo se garantizará la re-entrega de eventos en caso de fallo?

---

## 🗄️ Modelo de Datos Sugerido (Invariantes)

### Entidad: `ApiKey`
```json
{
  "id": "uuid",
  "name": "string",
  "secretHash": "string",
  "scopes": "array of strings",
  "status": "active | revoked",
  "createdAt": "timestamp"
}
```

### Entidad: `WebhookSubscription`
```json
{
  "id": "uuid",
  "targetUrl": "string (url)",
  "events": "array of event types (e.g. user.created)",
  "secretToken": "string",
  "isActive": "boolean"
}
```
