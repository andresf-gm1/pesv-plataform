# Builds de prueba

## Requisitos

- Node.js y dependencias instaladas con `npm install`.
- Android Studio con Android SDK para generar APK.
- Xcode y una cuenta Apple Developer para TestFlight.

## Android APK interno

1. Preparar los assets web moviles:

```powershell
Copy-Item -Path public\mobile.html -Destination mobile-dist\index.html -Force
Copy-Item -Path public\mobile.css -Destination mobile-dist\mobile.css -Force
Copy-Item -Path public\mobile.js -Destination mobile-dist\mobile.js -Force
npx cap sync android
```

2. Generar APK debug instalable directamente:

```powershell
cd android
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME="C:\Users\Andres Gutierrez\AppData\Local\Android\Sdk"
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
.\gradlew.bat assembleDebug
```

3. Descargar/compartir el APK generado:

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

Para una prueba interna profesional firmada, configure `android\app\build.gradle` con un `signingConfig` de release y ejecute:

```powershell
cd android
.\gradlew.bat assembleRelease
```

## iOS TestFlight

El proyecto queda listo para agregar iOS cuando exista una cuenta Apple Developer:

```powershell
npx cap add ios
npx cap sync ios
npx cap open ios
```

En Xcode:

1. Seleccionar el Team de Apple Developer.
2. Configurar Bundle Identifier: `com.fleetcommand.pesv`.
3. Verificar nombre visible: `Fleet Command`.
4. Product > Archive.
5. Distribute App > App Store Connect > TestFlight.

## Icono, nombre y splash

La app usa Capacitor con:

```json
{
  "appId": "com.fleetcommand.pesv",
  "appName": "Fleet Command",
  "webDir": "mobile-dist"
}
```

Después de cambiar iconos o splash, ejecute:

```powershell
npx cap sync android
npx cap sync ios
```
