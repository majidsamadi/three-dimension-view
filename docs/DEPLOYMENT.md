# Build, static hosting and rollback

The app is an independently deployable static Vue SPA. `npm ci && npm run build` creates `dist/`. No cloud infrastructure is applied by this repository, and no bank, identity provider or business API is activated.

Host over HTTPS, serve `.webmanifest` and JavaScript with correct MIME types, and use history fallback to `index.html` for application routes. Do not turn asset 404s into cached HTML. Example Nginx location rules inside an existing TLS server:

```nginx
root /srv/three-dimension-view/dist;
location /assets/ { try_files $uri =404; add_header Cache-Control "public, max-age=31536000, immutable"; }
location = /sw.js { add_header Cache-Control "no-cache"; }
location = /index.html { add_header Cache-Control "no-cache"; }
location / { try_files $uri $uri/ /index.html; }
add_header X-Content-Type-Options nosniff always;
add_header Referrer-Policy no-referrer always;
add_header Permissions-Policy "camera=(self), microphone=(), geolocation=()" always;
```

For subpath hosting, build with `APP_BASE_PATH=/three-dimension-view/`, scope all location/root/history rules consistently and use the generated manifest/service-worker base. For Android/iOS packaging, use the default `/` build. The native WebView loads bundled files; there is no live-development server URL in release configuration.

The service worker precaches the application’s static assets, not private API responses. A new build prompts for an update rather than automatically reloading a capture or dirty editor. Test offline recovery after the service worker has installed and controlled a page; first installation needs network access to obtain the app and any required OS AR runtime.

## Reproducible source and builds

`package-lock.json` records resolved JavaScript dependency versions. GitHub CI checks the exact PR merge candidate. Native project shells are generated using the locked Capacitor CLI, explicit privacy/camera config and local scanner plugin. Native signing remains an owner action. Android debug and iOS simulator artifacts are development evidence, not production distribution.

Source delivery uses a one-time checksum-verified bundle on the named implementation branch. It expands to normal reviewed source files and removes the transport payload. It never extracts the purchased template ZIP or private requirements documents. GitHub Actions cannot promote itself to main; merge remains an explicit repository action.

Rollback an application build by deploying a previously verified static artifact/native version. IndexedDB schema remains version 1 in this delivery. Do not clear application storage as a rollback strategy. Export a W3D backup before uninstalling, clearing a WebView or changing app identifiers/origins. A browser origin or native app-ID change uses a different local storage namespace.

## Branch cleanup

The main-push cleanup job checks only `feat/suha-local-phone-scanner`. It records the observed head, proves it is an ancestor of main, and uses a leased deletion that refuses a moved head. No unrelated branch is removed. Read the resulting remote branch list and merged PR status rather than assuming cleanup ran successfully.
