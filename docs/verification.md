# docs/verification.md — Estrategia de verificación

> **¿Qué es esto, en cristiano?** Cómo comprobamos que lo construido funciona de
> verdad. La "red de seguridad". Lo usa el reviewer para validar.

## Principio

Cada requisito (R<n>) de `requirements.md` se comprueba con **al menos un test**
automático. Si un requisito no se puede probar, está mal escrito.

## Tipos de prueba (según el proyecto)

- **Tests unitarios:** comprueban una pieza pequeña aislada (una función).
- **Tests de integración:** comprueban que varias piezas funcionan juntas.
- **Comprobación manual:** para cosas visuales o difíciles de automatizar; documéntala.

## Cómo se ejecutan

- Todo se lanza desde `init.sh` (configura ahí el comando de tests del proyecto).
- El reviewer ejecuta `init.sh` y exige que esté **todo en verde** antes de aprobar.

## Mapa de trazabilidad (lo rellena el implementer)

> Tabla que conecta cada requisito con su(s) test(s). El reviewer la verifica.

| Requisito | Test que lo cubre |
|-----------|-------------------|
| R1        |                   |
| R2        |                   |

## Qué NO se considera verificado

- "Yo lo he probado a mano una vez" no cuenta como test.
- Un test que siempre pasa pase lo que pase (falso positivo) no cuenta.
