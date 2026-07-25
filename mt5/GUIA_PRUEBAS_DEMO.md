# USDCAD Adaptive Risk EA - Guia de pruebas demo

## Objetivo de la prueba

Validar que el EA preserve capital, respete limites de riesgo y opere solamente USDCAD en M5 antes de cualquier uso real.

## Preparacion

1. Use una cuenta demo desde `100 USD`.
2. Abra solo un grafico de `USDCAD` en `M5`.
3. Active `InpDemoOnly = true`.
4. Mantenga `InpRiskPercent = 1.0`.
5. Revise que el broker permita el lote minimo calculado para USDCAD.
6. Descargue historial de `USDCAD` en `M5` y `D1`.

## Checklist de validacion

- El panel muestra balance, equity, drawdown, spread, modo y zona.
- El EA no opera simbolos distintos a USDCAD.
- No abre entradas si el spread supera `InpMaxSpreadPoints`.
- No abre entradas durante bloqueo por noticia relevante.
- No supera el maximo de operaciones simultaneas del modo actual.
- El lote se calcula segun el stop ATR y el riesgo configurado.
- Al alcanzar el 50% del objetivo, el SL se mueve a break even con margen de spread.
- El trailing stop se activa segun ATR.
- Si se supera el drawdown diario configurado, no abre nuevas entradas hasta el siguiente dia.

## Periodo minimo recomendado

- Prueba visual: 1 a 2 dias.
- Cuenta demo continua: 2 a 4 semanas.
- Evaluacion final: al menos 50 operaciones o un mes completo, lo que ocurra primero.

## Criterios de aprobacion

- Drawdown controlado dentro del limite definido.
- Profit factor mayor a `1.20` en demo antes de considerar ajustes.
- Sin errores recurrentes en la pestana `Experts`.
- Sin desviaciones del riesgo del 1% por operacion.
- Comportamiento razonable en horarios de noticias.

## Reglas de seguridad

No desactive el filtro demo ni aumente el riesgo hasta completar pruebas. Si el EA presenta operaciones fuera de la logica prevista, retirelo del grafico y revise `Experts`, `Journal` y el historial de operaciones.

