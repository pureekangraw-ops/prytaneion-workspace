# METRO Android

Thin Android WebView shell for the YGG METRO app. METRO remains the web/runtime owner; the APK adds an installable mobile entry without copying Hub or PRISM authority into the device.

## Build debug APK

From this directory:

```bash
gradle --no-daemon :app:assembleDebug
```

The APK is written to `app/build/outputs/apk/debug/app-debug.apk`.

## Preview build

Use the preview worker URL without changing source:

```bash
gradle --no-daemon -PmetroUrl=https://feature-metro-mobile-spectrum-go-hub.pureekangraw.workers.dev/metro :app:assembleDebug
```

## Boundary

- The APK contains no Hub credentials or authority.
- Login/session cookies stay in the WebView cookie store.
- HTTP cleartext is disabled.
- PRISM live readback continues through the Work-bound METRO/GO Hub route.
- Release signing remains a separate governed step; CI produces an unsigned debug artifact only.
