# Preparacion para produccion

## Web y landing

- Frontend/landing: publicar `public/` o el proyecto Express completo en Vercel si se separa frontend.
- Backend API: Railway o Render ejecutando `npm start`.
- Base de datos objetivo: PostgreSQL/Supabase. El backend principal usa Prisma/PostgreSQL; `data/*.json` queda solo como respaldo historico o insumo de migracion.
- Dominio: apuntar DNS al frontend y configurar `PUBLIC_BASE_URL`.
- HTTPS: usar certificado gestionado por Vercel/Railway/Render.

## Variables de entorno

Copiar `.env.example` a `.env` y configurar:

- `PUBLIC_BASE_URL`
- `API_BASE_URL`
- `DATABASE_URL`
- `JWT_SECRET`
- `MAPTILER_KEY`
- `TRACCAR_URL`, `TRACCAR_EMAIL`, `TRACCAR_PASSWORD`
- llaves de Wompi, MercadoPago o Stripe
- SMTP y correos de soporte

## Base de datos SQL

1. Crear proyecto en Supabase o PostgreSQL administrado.
2. Configurar `DATABASE_URL` con SSL cuando el proveedor lo requiera.
3. Ejecutar:

```powershell
npm run db:generate
npm run db:push
npm run db:seed
```

Para Supabase SQL Editor tambien puedes ejecutar `supabase/schema.sql`, generado desde `schema.prisma`.

Tablas cubiertas: empresas/clientes, usuarios, conductores, vehiculos, asignaciones, inspecciones, borradores, evidencias, GPS, viajes, rutas, geocercas, incidentes, combustible, gastos, configuracion PESV, reportes normativos, alertas, documentos y leads CRM.

## Operacion del primer cliente

- Crear empresa y usuarios admin/supervisor/conductor con `npm run db:seed` como base o desde el panel.
- Registrar los 10 vehiculos iniciales y asignar cada conductor a su vehiculo activo.
- Asociar `traccarDeviceId` por vehiculo antes de la salida operacional.
- Validar en `/admin`: checklist, GPS/mapas, conductores, vehiculos y geocercas.
- Validar en `/driver`: login, permisos GPS, iniciar viaje, preoperacional, evidencia fotografica, incidente y finalizar viaje.
- Validar en `/dashboard`: posiciones, clustering, estados, alertas, rutas y PDF.

## App movil

Android:

```powershell
Copy-Item -LiteralPath public\mobile.html -Destination mobile-dist\index.html -Force
Copy-Item -LiteralPath public\mobile.css -Destination mobile-dist\mobile.css -Force
Copy-Item -LiteralPath public\mobile.js -Destination mobile-dist\mobile.js -Force
Copy-Item -LiteralPath public\i18n.js -Destination mobile-dist\i18n.js -Force
Copy-Item -LiteralPath public\runtime-config.js -Destination mobile-dist\runtime-config.js -Force
npx cap sync android
cd android
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
.\gradlew.bat assembleDebug
```

APK debug:

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

iPhone/iOS:

- Preview inmediata: abrir `/app` o `/driver` desde Safari y agregar a pantalla de inicio como PWA.
- Build nativo: requiere macOS + Xcode + Apple Developer.

```bash
npx cap add ios
npx cap sync ios
npx cap open ios
```

## Permisos moviles

Android configurado con:

- Internet
- ubicacion fina y aproximada
- ubicacion en segundo plano
- foreground service location
- camara
- notificaciones

iOS requerira agregar en `Info.plist` cuando se cree el proyecto:

- `NSLocationWhenInUseUsageDescription`
- `NSLocationAlwaysAndWhenInUseUsageDescription`
- `NSCameraUsageDescription`
- `NSUserNotificationsUsageDescription`

## Checklist de pruebas

- Login admin y conductor.
- App movil: GPS apagado, GPS activo, iniciar viaje, finalizar viaje.
- Preoperacional dinamico y subida de fotos.
- Incidentes y boton emergencia.
- Dashboard: posiciones, vehiculos, alertas, KPIs y mapa.
- Admin: crear/editar checklist y verificar que la app lo reciba sin codigo nuevo.
- Landing: responsive, SEO, formulario de contacto, WhatsApp y demo.
- Produccion: HTTPS, variables, dominio, logs, backups y politicas de privacidad.

## Escalamiento

- Separar base por tenant logico usando `companyId`; para clientes grandes, usar proyectos Supabase separados.
- Activar backups diarios, retencion de logs y monitoreo de errores.
- Mover archivos/evidencias de base64 a Supabase Storage o S3 cuando el volumen crezca.
- Usar jobs programados para sincronizar Traccar, limpiar pings antiguos y generar reportes periodicos.
