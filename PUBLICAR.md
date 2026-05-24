# Publicar Fleet Command PESV

Repositorio conectado:

https://github.com/andresf-gm1/pesv-plataform

## Enlace para publicar el frontend

Abre este enlace, inicia sesion en Vercel y pulsa Deploy:

https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fandresf-gm1%2Fpesv-plataform

Configuracion esperada:

- Framework Preset: Other
- Build Command: `npm run build:frontend`
- Output Directory: `public`
- Install Command: `npm install`

Cuando Vercel termine, el enlace publico normalmente quedara parecido a:

https://pesv-plataform-ai.vercel.app

## Enlace para publicar el backend

Abre Render y crea el servicio desde el Blueprint del repositorio:

https://dashboard.render.com/blueprint/new

Selecciona el repositorio `andresf-gm1/pesv-plataform`. Render detectara `render.yaml`.

Variables necesarias en Render:

- `PUBLIC_BASE_URL`: URL final del frontend en Vercel.
- `API_BASE_URL`: URL final del backend en Render.
- `DATABASE_URL`: URL de Supabase/Postgres.
- `MAPTILER_KEY`: clave de mapas.
- `OPENWEATHER_API_KEY`: clave de clima.
- `SUPPORT_EMAIL`: correo de soporte.
- `WHATSAPP_NUMBER`: numero comercial.

## Texto corto para redes

Ya esta disponible Fleet Command PESV, una plataforma para monitoreo GPS, preoperacionales, cumplimiento PESV, gestion del riesgo vial y control operativo de flotas.

Solicita una demo aqui:

https://pesv-plataform-ai.vercel.app/demo
