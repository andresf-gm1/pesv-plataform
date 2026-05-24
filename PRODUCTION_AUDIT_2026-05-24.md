# Auditoria full stack PESV - 2026-05-24

## Estado ejecutivo

La plataforma queda lista para demo comercial inicial en local y preparada para despliegue gratuito con Render/Railway + Supabase. El backend principal usa Node.js/Express + Prisma/PostgreSQL. Para evitar demos rotas cuando PostgreSQL local no este disponible, se agrego fallback demo sobre `data/db.json` en autenticacion, dashboard, checklist, app movil, reportes basicos, CRM y chatbot.

## Funcionando

- Landing comercial en `/` con estilo SaaS premium.
- Demo visual en `/demo` con logo y tarjetas de roles.
- Login real y demo-login con fallback JSON si PostgreSQL/Supabase no esta disponible.
- Dashboard operativo en `/dashboard` con mapa dark mode y rutas API protegidas funcionales en modo fallback.
- App conductor en `/driver` con login, checklist, viaje, incidentes y tanqueo.
- Preoperacional dinamico con tipos Bueno/Regular/Malo, Si/No, numero, texto, seleccion, fotos/notas y variables humanas.
- Chatbot basico en `/api/chatbot/start` y `/api/chatbot/message`, con fallback sin DB.
- Smoke test ejecutable con `npm test`.
- Prisma schema valido con `npx prisma validate`.
- Dockerfile corregido para `schema.prisma` en la raiz.
- Render health check corregido a `/health`.
- Vercel rewrites actualizados para rutas principales.

## Pendiente para produccion real

- Crear proyecto Supabase y colocar `DATABASE_URL` real.
- Ejecutar `npx prisma db push` y `node seed.js` contra Supabase.
- Configurar `JWT_SECRET` fuerte.
- Configurar dominio y `PUBLIC_BASE_URL`.
- Configurar Traccar real: `TRACCAR_URL`, `TRACCAR_EMAIL`, `TRACCAR_PASSWORD`.
- Configurar SMTP/SendGrid para correos comerciales.
- Configurar Twilio/WhatsApp si se desea automatizacion por WhatsApp.
- Configurar `OPENWEATHER_API_KEY` para clima real.
- Configurar `MAPTILER_KEY` si se cambia de mapas libres a MapTiler.
- Revisar SEO final, Search Console, Meta Pixel y Google Ads tags antes de campañas.

## Rutas validadas

- `GET /health`
- `GET /`
- `GET /demo`
- `GET /dashboard`
- `GET /driver`
- `GET /reports`
- `GET /crm`
- `GET /logo.svg`
- `POST /api/auth/login`
- `POST /api/auth/demo-login`
- `POST /api/chatbot/start`
- `GET /api/fleet/live`
- `GET /api/mobile/bootstrap`
- `GET /api/checklist-config/active`
- `GET /api/reports/summary`
- `GET /api/alerts`
- `GET /api/inspections`
- `GET /api/crm/leads`

## Despliegue gratis recomendado

1. Base de datos: Supabase PostgreSQL.
2. Backend full stack: Render o Railway usando `npm start`.
3. Variables obligatorias: `DATABASE_URL`, `JWT_SECRET`, `PUBLIC_BASE_URL`, `API_BASE_URL`.
4. Inicializacion: `npm install`, `npx prisma generate`, `npx prisma db push`, `node seed.js`, `npm start`.
5. Validacion posterior: `npm test` apuntando a la URL publica con `SMOKE_BASE_URL=https://tu-dominio`.

## Clasificacion final

- Funcionando: demo local, landing, demo page, auth fallback, chatbot fallback, dashboard base, app conductor base, rutas principales, Prisma validate, smoke test.
- Pendiente: Supabase real, Traccar real, SMTP, WhatsApp, clima real, dominio, SEO/ads.
- Roto: PostgreSQL local no esta levantado en `localhost:5432`; por eso se activo fallback de demo. En produccion debe resolverse con Supabase o Postgres activo.
