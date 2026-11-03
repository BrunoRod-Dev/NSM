# Preparación de beta online

El panel Juegos permite crear sala privada, invitar amigos y arrancar la partida sin abrir un chat. Cualquier cuenta autenticada puede crear una sala y alojar el juego en su navegador. CRASH_HOST_USERNAME se conserva como configuración antigua sin restringir anfitriones. Las salas son efímeras y se cierran al reiniciar; no hay migración de anfitrión ni salas públicas.

## Archivos de despliegue preparados

Dockerfile compila Angular y servidor con Node 24 y ejecuta como usuario sin privilegios. compose.production.yaml agrega PostgreSQL persistente, comprobación de salud y Caddy con HTTPS. No publica el puerto de PostgreSQL ni el del proceso Node. La configuración de desarrollo sigue en compose.yaml.

Antes de publicar:

1. Configurar dominio DNS al VPS (80/443 disponibles) y Docker Compose. Copiar deploy/production.env.example a un archivo privado de variables, reemplazar dominio y contraseña por valores reales. Una contraseña hexadecimal aleatoria evita caracteres especiales en DATABASE_URL. Cambiar Admin/Admin2 de 1234 a contraseñas únicas antes de exponer el servicio.
2. Preparar /srv/nsm-games: crash-bash/ con la estructura archivos/juego, archivos/bios y runtime/loader.js del proyecto configurado; crash-bash.sbi; ctr.chd; ctr.sbi. Verificar derechos de alojamiento/distribución de los archivos. Se montan en solo lectura y su descarga requiere anfitrión autenticado.
3. Configurar RTC_ICE_SERVERS con STUN/TURN del proveedor. El ejemplo vacío NO asegura conexión entre casas. Mantener credenciales fuera del repositorio; las actuales se entregan a miembros de sala, por lo que conviene credenciales temporales y cuotas antes de una apertura amplia.
4. Revisar backups de PostgreSQL y probar restauración. El despliegue crea una base nueva: exportar/importar deliberadamente la base local si se quiere conservar cuentas y mensajes. No borrar volúmenes para actualizar.
5. Ejecutar en el VPS: docker compose --env-file /ruta/production.env -f compose.production.yaml up -d --build. El comando es para despliegue manual: no se ejecutó desde este trabajo. El Dockerfile no depende de un .env dentro de la imagen.
6. Crear cuentas desde el registro abierto. No se necesita código de invitación ni paso de recuperación en la interfaz. El navegador administra el guardado de credenciales mediante autocomplete; NSM solo almacena hashes.
7. Verificar /api/health por HTTPS, registro/login/logout, cookies seguras, chat WebSocket, descarga autorizada de archivos y una partida completa entre dos redes distintas. Forzar relay en una prueba controlada para comprobar TURN, no solo STUN.

TRUST_PROXY=true confía únicamente en el salto directo de proxy y solo debe usarse cuando el puerto de Node no es público. APP_ORIGIN debe ser exactamente https://dominio sin barra final. Caddy maneja WebSocket y certificados. La imagen se construyó localmente y la configuración Compose pasó validación. Queda pendiente la prueba operativa con dominio y HTTPS en el VPS.

Una sola instancia de app: las salas y presencia actuales no se coordinan entre réplicas. Cada reinicio termina partidas activas; programar despliegues fuera de las sesiones. Los guardados de navegador pertenecen al origen: localhost y el dominio público no comparten guardados automáticamente. Respaldarlos antes de migrar.

## Operación mínima

Monitorear salud, espacio libre y transferencia de TURN. Respaldar la base diariamente y conservar una imagen anterior para reversión. Un rollback de código debe respetar las migraciones ya aplicadas. Probar desconexión de anfitrión, cierre de pestaña, bloqueos y reconexión de invitado antes de ampliar la beta.
