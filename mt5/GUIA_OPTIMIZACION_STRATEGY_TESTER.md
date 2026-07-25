# USDCAD Adaptive Risk EA - Guia de optimizacion en Strategy Tester

## Configuracion base

- Expert: `USDCAD_AdaptiveRisk_EA`.
- Symbol: `USDCAD`.
- Timeframe: `M5`.
- Model: `Every tick based on real ticks`, si esta disponible.
- Deposit inicial sugerido: `100 USD`, `200 USD` y `500 USD` en pruebas separadas.
- Leverage: igual al broker demo previsto.
- Spread: real o variable.

## Periodos de backtesting requeridos

Ejecute pruebas separadas para:

- 5 anos.
- 3 anos.
- 1 ano.
- 6 meses.
- 3 meses.

## Parametros recomendados para optimizar

- `InpMaxDailyDrawdownPercent`: 2.0 a 6.0, paso 0.5.
- `InpMaxSpreadPoints`: 15 a 35, paso 5.
- `InpMinAtrPoints`: 20 a 60, paso 5.
- `InpAtrSlMultiplier`: 1.2 a 2.5, paso 0.1.
- `InpAtrTrailingMultiplier`: 0.8 a 2.0, paso 0.1.
- `InpVolatileAtrMultiplier`: 1.1 a 1.8, paso 0.1.
- `InpBaseRewardRisk`: 1.5 a 2.5, paso 0.25.
- `InpVolatileRewardRisk`: 2.0 a 3.5, paso 0.25.
- `InpNewsBlockMinutesBefore`: 30 a 90, paso 15.
- `InpNewsBlockMinutesAfter`: 30 a 90, paso 15.
- `InpZoneBiasFactor`: 0.30 a 0.75, paso 0.05.
- `InpMinMinutesBetweenEntries`: 15 a 120, paso 15.
- `InpMinDecisionScore`: 60 a 80, paso 2.
- `InpLiquidityProximityAtr`: 0.20 a 0.60, paso 0.05.
- `InpFvgMinAtrFraction`: 0.10 a 0.35, paso 0.05.
- `InpOrderBlockBodyAtrFraction`: 0.35 a 0.80, paso 0.05.
- `InpStrongTrendThreshold`: 0.45 a 0.75, paso 0.05.

No optimice agresivamente `InpContextRefreshSeconds`, `InpMaxRatesPerHorizon` ni `InpFullHistoryMaxBars` solo para ganar velocidad. Esos parametros controlan el equilibrio entre calidad del contexto y consumo de CPU/memoria.

## Metricas del informe

Para cada periodo registre:

- Profit Factor.
- Ganancia neta.
- Drawdown absoluto y relativo.
- Numero de operaciones.
- Tasa de acierto.
- Mejor configuracion encontrada.
- Balance final.
- Mayor perdida consecutiva.
- Promedio de ganancia/perdida.

## Criterio de seleccion

No seleccione la configuracion solo por ganancia neta. Priorice:

1. Menor drawdown relativo.
2. Profit factor estable en todos los periodos.
3. Numero suficiente de operaciones.
4. Resultados similares entre 5 anos, 3 anos y 1 ano.
5. Buen comportamiento en 6 y 3 meses sin sobreoptimizar.

## Plantilla de informe

```text
Periodo:
Deposito inicial:
Balance final:
Ganancia neta:
Profit Factor:
Drawdown maximo:
Numero de operaciones:
Tasa de acierto:
Mejor configuracion:
Observaciones:
Decision:
```

## Nota importante

El Strategy Tester no siempre reproduce el calendario economico igual que una cuenta demo en vivo. Use el filtro de noticias como capa de proteccion operativa y valide su funcionamiento en demo.
