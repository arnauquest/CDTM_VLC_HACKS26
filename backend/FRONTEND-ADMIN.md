# Adaptador local para marca y administración

`handleFrontendAdmin` de `frontend-admin.mjs` acepta `{path, method, input, session, store, engine, voice, ai, env, rootDir, url}`. `path` puede ser `/brand`, `/api/brand` o el array de segmentos del servidor. Devuelve `{status, body, headers?}`, o `null` cuando otra capa es responsable de la ruta. Los errores incluyen `status` para la respuesta HTTP.

El servidor debe llamar **GET `/brand` antes de exigir sesión**, y solo esa operación es pública. El resto requiere una sesión; marca y administración requieren `session.role === 'admin'`. `/notifications/count` funciona para sesiones de cliente, asesor y administrador. El servidor sigue siendo responsable de autenticar, comprobar origen, limitar el cuerpo y transmitir la respuesta. Para `body` de tipo `Buffer`, conservar los headers y escribir los bytes directamente.

## Marca

- `GET /brand`: configuración publicada; no devuelve el borrador.
- `PUT /brand/draft`: valida y guarda un borrador en SQLite.
- `POST /brand/publish`: publica el cuerpo recibido; si está vacío, publica el borrador guardado.
- `POST /brand/reset`: restaura **el borrador** a los valores predeterminados. La publicación activa no cambia hasta publicar.
- `GET /brand/voices`: devuelve exclusivamente `ELEVENLABS_VOICE_ID` cuando existe, sin afirmar que sea una voz clonada o entrenada.
- `POST /brand/assets`: JSON `{kind: "logo" | "icon", dataUrl: "data:image/png;base64,..."}`. También admite `{kind, mime, base64}`. Devuelve `{url, mime, sha256}`. El frontend debe convertir el fichero a un data URI antes de enviarlo.

Las imágenes PNG/JPEG/WebP están limitadas a 2 MiB, con base64 y firma binaria comprobados. SVG, URLs externas y hojas de estilo externas se rechazan. Las imágenes se guardan en SQLite como datos; no se escriben rutas suministradas por usuarios. Los colores admiten `#RRGGBB`. `integrationActive` es falso: no se anuncia una integración MCP inexistente. Los cambios de borrador y publicación se auditan.

## Datos y límites que debe mostrar la interfaz

- `/admin/summary` cuenta las familias reales del Store y un asesor local compartido. `silenceRate` es la fracción de decisiones de análisis `none` por evento/familia, tomando la última revisión. Sin decisiones devuelve `null`.
- SLA, capacidad y objetivo de SLA son `null`, porque no están configurados ni medidos. El frontend debe mostrar «Sin datos» y no dividir por capacidad nula. La fila de carga tiene `status: "not_measured"` y `statusLabel`.
- `/notifications/count` conserva el campo `unread` que consume la UI, pero devuelve `countKind` y `readReceiptsTracked: false`. Para clientes cuenta comunicaciones disponibles; para asesores/admin cuenta revisiones pendientes, trabajos fallidos y solicitudes humanas no resueltas. No se inventan recibos de lectura.
- `/admin/users` describe los dos roles de sesión de la demo, no cuentas de producción. El asesor tiene ID `local-advisor`. Crear usuarios o editar permisos devuelve `409` con explicación.
- La cola de onboarding está vacía. `autoAccept` se puede guardar, con `registrationAvailable:false`; no crea familias. Aceptar/rechazar solicitudes inexistentes devuelve `404`.
- La reasignación devuelve `409`: solo existe un asesor local y no hay un directorio multiusuario.
- Guardrails son de solo lectura (`editable:false`) y describen controles implementados. Los cambios devuelven `409`; no se anuncia certificación FINRA/SEC.
- Integraciones muestran presencia de configuración real. «Verificar» ejecuta un diagnóstico de **configuración**, sin red ni gasto. Devuelve `diagnostic.networkChecked:false`; el texto de éxito debe ser «Configuración revisada», no «Conexión verificada». No se devuelven claves.
- Facturación devuelve `configured:false`, `chargesEnabled:false`, fechas y asientos nulos. La UI debe mostrar que no está configurada. Comprar asientos devuelve `409`, descargar facturas `404`.
- `/admin/compliance/report` exporta CSV real de familias, snapshots, cambios, auditoría, aprobaciones, comunicaciones, conversaciones y trabajos. No incluye claves, transcripciones, audios ni rutas locales; neutraliza fórmulas de hojas de cálculo. Es un registro local, no un informe de certificación regulatoria.

## Verificación

`node --test backend/frontend-admin.test.mjs`

Las pruebas cubren separación borrador/publicación, autenticación, imágenes y URLs peligrosas, métricas derivadas, aislamiento de notificaciones, CSV, privacidad de credenciales y operaciones explícitamente no disponibles.
