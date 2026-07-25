# USDCAD Adaptive Risk EA - Manual de configuracion

## Perfil operativo

- Activo permitido: `USDCAD`.
- Timeframe de senal: `M5`.
- Uso inicial recomendado: cuenta demo.
- Riesgo base: `1%` del balance por operacion.
- Sin martingala, sin grid infinito y sin duplicacion progresiva de lotes.
- Version 2.0: motor multi-horizonte con score institucional y razones auditables.

## Modos de crecimiento

El EA selecciona el modo automaticamente por balance:

- Conservador: balance menor a `200 USD`, maximo `2` operaciones simultaneas. Puede forzar lote minimo del broker.
- Moderado: balance entre `200` y `500 USD`, maximo `3` operaciones simultaneas.
- Avanzado: balance superior a `500 USD`, maximo `5` operaciones simultaneas. Permite trailing ATR para operaciones de mayor duracion.

## Parametros principales

- `InpRiskPercent`: porcentaje de riesgo por operacion. Valor inicial recomendado: `1.0`.
- `InpMaxDailyDrawdownPercent`: drawdown diario maximo. Si se supera, el EA no abre nuevas entradas hasta el siguiente dia.
- `InpMaxTotalRiskPercent`: riesgo agregado maximo de posiciones abiertas del EA.
- `InpMaxSpreadPoints`: spread maximo permitido en puntos.
- `InpMinMinutesBetweenEntries`: pausa minima entre entradas para evitar sobreoperacion.
- `InpMinAtrPoints`: volatilidad minima requerida para operar.
- `InpAtrSlMultiplier`: multiplicador ATR para stop loss.
- `InpBaseRewardRisk`: relacion riesgo beneficio normal, por defecto `1:2`.
- `InpVolatileRewardRisk`: relacion riesgo beneficio cuando la volatilidad es favorable, por defecto `1:3`.
- `InpBreakEvenAtTargetPercent`: avance del TP requerido para mover SL a break even.
- `InpUseEconomicCalendar`: activa el filtro de calendario economico.
- `InpMinDecisionScore`: score minimo para abrir una operacion.
- `InpContextRefreshSeconds`: frecuencia de refresco del contexto de mercado.
- `InpMaxRatesPerHorizon`: limite de velas por horizonte para controlar CPU/memoria.
- `InpFullHistoryMaxBars`: maximo de velas D1 usadas para el horizonte `ALL`.

## Logica de entrada

Compra:

- SMA 50 por encima de SMA 200.
- EMA 5 cruza al alza SMA 50.
- Cierre por encima de SMA 200.
- ATR mayor al minimo configurado.
- Sin noticia relevante cercana.
- Spread dentro del limite.

Venta:

- SMA 50 por debajo de SMA 200.
- EMA 5 cruza a la baja SMA 50.
- Cierre por debajo de SMA 200.
- ATR mayor al minimo configurado.
- Sin noticia relevante cercana.
- Spread dentro del limite.

## Zonas historicas

El EA calcula maximo, minimo, rango y posicion actual del precio en cuatro horizontes base de zona:

- Dias: `InpHistoricalDays`, usando velas D1.
- Semanas: `InpHistoricalWeeks`, usando velas W1.
- Meses: `InpHistoricalMonths`, usando velas MN1.
- Anos: `InpHistoricalYears`, usando velas MN1 equivalentes a 12 meses por ano.

Con esos datos construye un rango compuesto ponderado:

- 10% rango diario.
- 20% rango semanal.
- 30% rango mensual.
- 40% rango anual.

Ese rango compuesto define:

- Zona baja: favorece compras y reduce ventas.
- Zona media: opera normalmente segun tendencia.
- Zona alta: favorece ventas y reduce compras.

Los niveles se recalculan semanalmente con datos historicos y tambien al iniciar el EA. No se usan niveles fijos permanentes.

## Motor institucional de contexto

La version 2.0 analiza estos horizontes:

- Historico completo disponible controlado por `InpFullHistoryMaxBars`.
- 10 anos.
- 5 anos.
- 3 anos.
- 1 ano.
- 6 meses.
- 3 meses.
- 1 mes.
- 1 semana.
- 1 dia.
- 24 horas.
- 12 horas.
- 4 horas.
- 1 hora.
- 15 minutos.
- 5 minutos.

Para cada horizonte calcula:

- Maximo, minimo y precio medio.
- ATR aproximado por rango medio.
- Volatilidad porcentual.
- Tendencia, pendiente y fuerza de tendencia.
- Distancia al maximo y al minimo.
- Soporte y resistencia recientes.
- Zonas de liquidez por volumen de ticks cerca de extremos.
- Order blocks aproximados por vela contraria previa a impulso.
- Fair Value Gaps aproximados por desequilibrio de tres velas.
- Supply, demand, Break of Structure y Change of Character.

## Motor de decision por score

Antes de abrir una operacion el EA calcula `Score BUY` y `Score SELL`. El score incluye:

- Tendencia multi-horizonte.
- Momentum EMA 5 / SMA 50 / SMA 200.
- Volatilidad ATR.
- Coste por spread.
- Noticias de alto impacto.
- Liquidez, soportes, resistencias, supply y demand.
- Fair Value Gaps y order blocks.
- BOS/CHoCH.
- Capacidad de riesgo disponible.
- Limites de operaciones simultaneas.

Solo abre operaciones si el score supera `InpMinDecisionScore`, no hay bloqueo de riesgo/noticias y un lado supera al otro con margen suficiente.

## Protecciones de ejecucion

La version auditada valida antes de enviar una orden:

- Permisos de trading del terminal, MQL y cuenta.
- Stop level minimo del broker.
- Freeze level antes de modificar stops.
- Margen libre disponible mediante `OrderCalcMargin`.
- Riesgo monetario de la operacion y riesgo agregado.
- Lote minimo, maximo y step real del broker.
- Pausa minima entre entradas.

Si una validacion falla, el EA bloquea la operacion y muestra la razon en el panel.

## Telegram

Parametros:

- `InpUseTelegram`: activa o desactiva Telegram.
- `InpTelegramBotToken`: token del bot.
- `InpTelegramChatId`: chat ID destino.

MT5 requiere agregar esta URL permitida:

```text
https://api.telegram.org
```

Eventos enviados:

- Apertura de operacion.
- Cierre de operacion.
- Resumen diario.
- Resumen semanal.
- Alertas de riesgo.
- Alertas de noticias.
