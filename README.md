# ROOM ISP · HTML Enterprise V2

Frontend SPA en HTML + CSS + JavaScript para el backend Supabase existente de ROOM ISP.

## Qué NO hace este paquete
- No crea nuevas tablas ni migraciones.
- No usa service_role.
- No contiene secretos de Telegram ni CRON.
- No reemplaza la command queue de MikroTik.
- No marca como terminadas operaciones críticas que requieren ACK del router.

## Archivos
- `index.html`: entrada real.
- `styles.css`: diseño responsive, modo claro/oscuro y login.
- `app.js`: autenticación, roles y módulos.
- `config.js`: solamente configuración pública.
- `vercel.json`: despliegue SPA en Vercel.
- `README.md`: esta guía.

## Arquitectura
Navegador -> Supabase Auth/RLS -> PostgreSQL/Storage + Edge Functions -> MikroTik/Telegram.

## Para probar localmente
Puedes usar una extensión como Live Server en VS Code o cualquier servidor HTTP estático.
No abras `index.html` con `file://` si el navegador bloquea llamadas externas.

## GitHub Pages
Al ser HTML/JS estático puede publicarse en GitHub Pages. Supabase y las Edge Functions siguen siendo el backend.
Si luego se usan rutas físicas, workers o headers especiales, Vercel es más cómodo; en esta versión la navegación es SPA y funciona desde `index.html`.

## Vercel
1. Sube estos 6 archivos a la raíz del repositorio.
2. Importa el repositorio en Vercel.
3. Framework: `Other` / sitio estático.
4. No requiere npm ni build.
5. Deploy.

## Seguridad
`config.js` contiene solo valores públicos. La publishable key es cliente. NO reemplazarla por service_role/secret.
Las acciones críticas (suspender, reconectar, velocidad, aprobar pagos) deben pasar por las Edge Functions/RPC autorizadas y MFA cuando aplique.

## Estado funcional incluido
- Login Supabase + recuperación de contraseña.
- Resolución de Superadmin / personal ISP / cliente.
- Dashboard por rol.
- Clientes + alta mediante `create_customer`.
- Planes + alta mediante `create_plan`.
- Servicios (consulta).
- MikroTik + enrollment mediante `create_router_enrollment`.
- Pagos y reportes.
- Mapa Leaflet/OpenStreetMap.
- Incidencias, soporte, inventario, órdenes, notificaciones, configuración.
- Portal cliente multi-servicio.
- Telegram link mediante `create_telegram_link_token`.
- GPS mediante `update_my_service_location`.
- Perfil mediante `update_my_customer_profile_full`.
- MFA TOTP con Supabase Auth.

## Antes de producción
Validar end-to-end con usuarios de laboratorio, RLS, MFA, Telegram real, MikroTik v6/v7, SUSPEND/ENABLE/UPDATE_SPEED, pago + reconexión, cron/worker y aislamiento entre organizaciones.
