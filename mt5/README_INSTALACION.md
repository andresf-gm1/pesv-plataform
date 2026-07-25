# USDCAD Adaptive Risk EA - Instalacion

## Archivos del paquete

- `USDCAD_AdaptiveRisk_EA.mq5`: codigo fuente MQL5 del Expert Advisor.
- `README_INSTALACION.md`: instalacion y compilacion.
- `MANUAL_CONFIGURACION.md`: parametros operativos.
- `GUIA_PRUEBAS_DEMO.md`: validacion inicial en cuenta demo.
- `GUIA_OPTIMIZACION_STRATEGY_TESTER.md`: backtesting y optimizacion.

## Requisitos

- MetaTrader 5 actualizado.
- Cuenta demo habilitada.
- Simbolo `USDCAD` disponible en Market Watch.
- Historial suficiente de USDCAD en M5 y D1.
- Para Telegram: permitir `https://api.telegram.org` en `Tools > Options > Expert Advisors > Allow WebRequest for listed URL`.

## Instalacion

1. Abra MT5.
2. Vaya a `File > Open Data Folder`.
3. Entre a `MQL5 > Experts`.
4. Cree una carpeta, por ejemplo `USDCAD_AdaptiveRisk`.
5. Copie `USDCAD_AdaptiveRisk_EA.mq5` dentro de esa carpeta.
6. Abra MetaEditor desde MT5 o con `F4`.
7. Abra el archivo `.mq5`.
8. Compile con `F7`.
9. Si la compilacion es correcta, MetaEditor generara `USDCAD_AdaptiveRisk_EA.ex5` en la misma carpeta.

## Activacion en grafico

1. En MT5, abra un grafico de `USDCAD`.
2. Cambie el timeframe a `M5`.
3. Arrastre el EA desde `Navigator > Expert Advisors`.
4. Active `Algo Trading`.
5. Verifique que `InpDemoOnly = true` durante las primeras pruebas.

## Nota sobre EX5

El archivo `.ex5` debe compilarse en MetaEditor porque es un binario generado por la instalacion local de MetaTrader 5. En este equipo no se encontro `metaeditor64.exe` en el PATH, por lo que se entrega el `.mq5` listo para compilar.

