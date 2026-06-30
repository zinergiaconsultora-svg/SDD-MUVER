# 05 · Modelo de datos

> **¿Qué es esto?** La descripción de qué información guarda el sistema y cómo se
> relaciona. Piénsalo como las "fichas" o "tablas": una de clientes, una de productos,
> una de contratos… y qué campos tiene cada una. No necesitas saber de bases de datos:
> el Analista te pregunta "¿qué cosas necesitas apuntar de cada cliente?" y lo monta.

> **En cristiano:** una "tabla" es como una hoja de Excel. Cada fila es un elemento
> (un cliente) y cada columna es un dato (nombre, teléfono…). Una "relación" es cuando
> una tabla apunta a otra (un contrato pertenece a un cliente).

---

## Entidades (las "tablas")

### [Nombre de la entidad, ej: Cliente]
| Campo | Qué guarda | Tipo (texto/número/fecha/sí-no) | ¿Obligatorio? |
|-------|-----------|---------------------------------|----------------|
|       |           |                                 |                |

**Se relaciona con:** (ej: "un Cliente tiene muchos Contratos")

---

### [Nombre de la entidad]
| Campo | Qué guarda | Tipo | ¿Obligatorio? |
|-------|-----------|------|----------------|
|       |           |      |                |

**Se relaciona con:**

---

## Estados y listas cerradas (enums)
> Valores fijos que puede tomar algo. Ej: un lead puede estar en "nuevo / contactado / presupuestado / ganado / perdido".

- **[Nombre]:** valor1, valor2, valor3…
