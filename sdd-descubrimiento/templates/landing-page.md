# Plantilla de Descubrimiento: Landing Page & Conversión

Esta plantilla guía el análisis al estructurar páginas de aterrizaje enfocadas en conversión, captación de leads o marketing.

## 🔑 Preguntas de Choque (Para el Analista)

### 1. Captación de Leads
- ¿Qué datos mínimos se deben capturar en los formularios (ej: solo Email, o también Nombre, Teléfono, Empresa)?
- ¿A qué herramientas se deben enviar los datos capturados de forma inmediata (ej: ActiveCampaign, Hubspot, Google Sheets, base de datos local)?

### 2. Analítica y Píxeles de Seguimiento
- ¿Qué píxeles de seguimiento se deben instalar (Google Analytics, Meta Pixel, Hotjar, TikTok Pixel)?
- ¿Cuáles son los eventos de conversión clave a traquear (ej: click en botón, envío de formulario, scroll del 50%)?

### 3. SEO y Metadatos
- ¿Qué palabras clave principales debe atacar la landing page?
- ¿Qué metadatos (OpenGraph) se requieren para que al compartir la URL en WhatsApp/Slack se muestre una imagen de vista previa atractiva?

---

## 🗄️ Modelo de Datos Sugerido (Invariantes)

### Entidad: `Lead`
```json
{
  "id": "uuid",
  "email": "string (email)",
  "name": "string (opcional)",
  "phone": "string (opcional)",
  "source": "string (ej: google-ads, organic)",
  "createdAt": "timestamp"
}
```
