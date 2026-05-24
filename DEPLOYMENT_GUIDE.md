# Guia paso a paso para publicar Fleet Command PESV gratis al inicio

Esta guia deja la plataforma compartible mediante una URL publica con:

- Frontend en Vercel.
- Backend en Render o Railway.
- Base de datos objetivo en Supabase PostgreSQL.
- HTTPS automatico.
- Demo publica para clientes, empresas y auditores PESV.

> Estado actual: el proyecto ya incluye `vercel.json`, `render.yaml`, `railway.json`, `.env.example`, `supabase/schema.sql` y generacion de `public/runtime-config.js`.

## 1. Crear cuenta en Vercel

1. Entre a [vercel.com](https://vercel.com).
2. Seleccione `Sign Up`.
3. Use GitHub como metodo de registro. Esto simplifica importar el proyecto.
4. Elija el plan gratuito Hobby para iniciar.
5. Verifique el correo si Vercel lo solicita.

Vercel genera HTTPS automaticamente y crea una URL publica tipo:

```text
https://mi-proyecto.vercel.app
```

## 2. Crear cuenta en GitHub

1. Entre a [github.com](https://github.com).
2. Cree una cuenta o inicie sesion.
3. Cree un repositorio nuevo, por ejemplo:

```text
fleet-command-pesv
```

4. Marquelo como `Private` si aun no quiere publicar el codigo, o `Public` si desea visibilidad.
5. No agregue README desde GitHub si va a subir el proyecto local completo.

## 3. Subir el proyecto a GitHub

Desde la carpeta del proyecto:

```powershell
cd "C:\Users\Andres Gutierrez\mi-sistema"
git init
git add .
git commit -m "Preparar plataforma PESV para despliegue publico"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/fleet-command-pesv.git
git push -u origin main
```

Si Git no esta instalado, instale Git for Windows desde [git-scm.com](https://git-scm.com) y reinicie PowerShell.

## 4. Crear proyecto en Supabase

1. Entre a [supabase.com](https://supabase.com).
2. Cree una cuenta.
3. Cree un nuevo proyecto.
4. Nombre sugerido:

```text
fleet-command-pesv
```

5. Elija una region cercana a sus clientes iniciales.
6. Guarde la clave de base de datos en un lugar seguro.
7. Espere a que Supabase termine de crear el proyecto.

## 5. Crear tablas en Supabase

1. En Supabase, abra `SQL Editor`.
2. Cree una consulta nueva.
3. Copie el contenido de:

```text
supabase/schema.sql
```

4. Ejecute la consulta.
5. Verifique en `Table Editor` que existan tablas como:

```text
companies
users
vehicles
location_pings
inspections
incidents
checklist_configs
leads
```

Nota importante: el backend actual todavia usa archivos JSON para la demo local. El esquema Supabase deja la estructura lista para migrar a PostgreSQL antes de produccion con datos reales.

## 6. Obtener DATABASE_URL de Supabase

1. En Supabase abra `Project Settings`.
2. Entre a `Database`.
3. Busque `Connection string`.
4. Copie la cadena tipo URI.
5. Debe verse parecido a:

```text
postgresql://postgres:[PASSWORD]@db.xxxxx.supabase.co:5432/postgres
```

6. Reemplace `[PASSWORD]` por la clave real de la base.

## 7. Publicar backend en Render

1. Entre a [render.com](https://render.com).
2. Cree cuenta usando GitHub.
3. Seleccione `New`.
4. Seleccione `Web Service`.
5. Conecte el repositorio `fleet-command-pesv`.
6. Configure:

```text
Name: fleet-command-pesv-api
Runtime: Node
Build Command: npm install
Start Command: npm start
Plan: Free o Starter segun disponibilidad
```

7. Agregue variables de entorno:

```text
NODE_ENV=production
PORT=3000
PUBLIC_BASE_URL=https://TU_FRONTEND.vercel.app
API_BASE_URL=https://TU_BACKEND.onrender.com
DATABASE_URL=postgresql://...
JWT_SECRET=una_clave_larga_y_segura
MAPTILER_KEY=tu_key_si_la_tienes
OPENWEATHER_API_KEY=tu_key_si_la_tienes
SUPPORT_EMAIL=ventas@tuempresa.com
WHATSAPP_NUMBER=573000000000
```

8. Pulse `Create Web Service`.
9. Espere el build.
10. Render entregara una URL tipo:

```text
https://fleet-command-pesv-api.onrender.com
```

Guarde esa URL: sera el `API_BASE_URL` del frontend.

## 8. Alternativa: publicar backend en Railway

1. Entre a [railway.com](https://railway.com).
2. Cree cuenta con GitHub.
3. Seleccione `New Project`.
4. Seleccione `Deploy from GitHub repo`.
5. Elija el repositorio.
6. Railway detectara Node.js.
7. Configure variables en `Variables`:

```text
NODE_ENV=production
PORT=3000
PUBLIC_BASE_URL=https://TU_FRONTEND.vercel.app
API_BASE_URL=https://TU_BACKEND.up.railway.app
DATABASE_URL=postgresql://...
JWT_SECRET=una_clave_larga_y_segura
SUPPORT_EMAIL=ventas@tuempresa.com
WHATSAPP_NUMBER=573000000000
```

8. Abra `Settings`.
9. Genere un dominio publico.
10. Use esa URL como backend publico.

## 9. Publicar frontend en Vercel

1. Entre a Vercel.
2. Seleccione `Add New`.
3. Seleccione `Project`.
4. Importe el repositorio de GitHub.
5. En configuracion:

```text
Framework Preset: Other
Build Command: npm run build:frontend
Output Directory: public
Install Command: npm install
```

6. Agregue variables de entorno en Vercel:

```text
NODE_ENV=production
PUBLIC_BASE_URL=https://TU_FRONTEND.vercel.app
API_BASE_URL=https://TU_BACKEND.onrender.com
SUPPORT_EMAIL=ventas@tuempresa.com
WHATSAPP_NUMBER=573000000000
MEETING_URL=https://calendly.com/tuempresa/demo
```

7. Pulse `Deploy`.
8. Vercel generara una URL publica:

```text
https://fleet-command-pesv.vercel.app
```

## 10. Como funciona la conexion frontend-backend

Durante el build de Vercel se ejecuta:

```text
npm run build:frontend
```

Ese comando genera:

```text
public/runtime-config.js
```

con `API_BASE_URL`. Luego cualquier llamada a:

```js
fetch("/api/...")
```

se redirige automaticamente al backend publico.

Esto permite que la landing, demo, login, dashboard y app movil web funcionen desde Vercel aunque la API viva en Render o Railway.

## 11. Conectar dominio personalizado

1. Compre un dominio en Namecheap, GoDaddy, Cloudflare, Hostinger u otro proveedor.
2. En Vercel abra el proyecto.
3. Vaya a `Settings`.
4. Abra `Domains`.
5. Agregue:

```text
www.tudominio.com
tudominio.com
```

6. Vercel mostrara registros DNS.
7. En el proveedor del dominio agregue los registros que Vercel indique.
8. Espere propagacion DNS.
9. Vercel activara HTTPS automaticamente.

## 12. Acceso demo para clientes

Use:

```text
https://TU_FRONTEND.vercel.app/demo
```

Credenciales demo:

```text
admin@demo.com / Admin123
supervisor@demo.com / Supervisor123
auditor@demo.com / Auditor123
conductor@demo.com / Ambulancia123
```

Rutas publicas importantes:

```text
/              landing
/demo          demo publica
/login         ingreso
/dashboard     monitoreo GPS
/reports       indicadores
/admin         configuracion PESV
/app           QR y preview movil
/driver        app conductor web/PWA
```

## 13. Probar desde celular

1. Abra la URL de Vercel desde Android o iPhone.
2. Entre a `/app`.
3. Escanee el QR o abra `/driver`.
4. Inicie sesion con:

```text
conductor@demo.com / Ambulancia123
```

5. Permita ubicacion.
6. Pruebe:

- compartir ubicacion
- iniciar viaje
- finalizar viaje
- preoperacional movil
- subir fotos
- reportar incidente
- boton emergencia

## 14. Publicar nuevas versiones

Cada vez que haga cambios:

```powershell
git add .
git commit -m "Mejoras plataforma PESV"
git push
```

Vercel y Render/Railway desplegaran automaticamente si auto-deploy esta activo.

## 15. Actualizar variables .env

Frontend Vercel:

1. Proyecto en Vercel.
2. `Settings`.
3. `Environment Variables`.
4. Editar o agregar variable.
5. Hacer redeploy.

Backend Render:

1. Servicio en Render.
2. `Environment`.
3. Editar variables.
4. Render reinicia o redeploya el servicio.

Backend Railway:

1. Proyecto en Railway.
2. Servicio backend.
3. `Variables`.
4. Editar variables.
5. Redeploy.

## 16. Checklist antes de mostrar a clientes

- Landing carga rapido desde celular.
- `/demo` inicia sesion correctamente.
- `/dashboard` muestra mapa y flota.
- `/admin` permite ver checklist y flota.
- `/driver` abre desde celular.
- Permisos GPS funcionan.
- Formulario de contacto registra lead.
- WhatsApp abre con mensaje correcto.
- HTTPS activo.
- Dominio configurado.
- Variables `API_BASE_URL` y `PUBLIC_BASE_URL` correctas.

## 17. Limitaciones actuales importantes

- El APK debug sirve para pruebas internas, no para Play Store.
- Para Play Store se requiere APK/AAB release firmado.
- iOS nativo requiere macOS, Xcode y Apple Developer.
- Supabase esta preparado con schema, pero la demo local aun usa JSON. Para produccion real con datos sensibles, migrar persistencia a PostgreSQL.
- Para pagos reales se deben activar llaves y webhooks de Wompi, MercadoPago o Stripe.

## Fuentes oficiales consultadas

- Vercel Environment Variables: https://vercel.com/docs/environment-variables
- Vercel deployment methods: https://vercel.com/docs/deployments/deployment-methods
- Render Node Express deploy: https://render.com/docs/deploy-node-express-app
- Render environment variables: https://render.com/docs/environment-variables
- Supabase Database overview: https://supabase.com/docs/guides/database/overview
