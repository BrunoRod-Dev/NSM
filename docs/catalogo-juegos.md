# Catálogo y adaptadores

Las cuentas, amistades y mensajes siguen en sus módulos existentes. GamesService gestiona salas, invitaciones, plazas y autorización. Cada sala e invitación incluye gameId y metadatos públicos del juego. La señalización WebRTC no cambia.

## Dónde agregar un juego

1. Registrar un identificador estable en packages/contracts/src/index.ts (gameDefinitions), con nombre, plazas y adaptador. Mantener enabled=false hasta comprobar compatibilidad.
2. Agregar un resolver en apps/server/src/games/game-catalog.ts que lea exclusivamente configuración del servidor. Requiere disco, BIOS y loader; SBI es opcional según edición. Los nombres recibidos por HTTP nunca son rutas. La disponibilidad comprueba archivos locales y no garantiza compatibilidad del título.
3. Agregar un adaptador en apps/web/public/crash y registrarlo en game-adapters.js. La carpeta conserva su nombre histórico para evitar cambios de URLs; player.js, player-controls.js, captura y WebRTC son compartidos. Las rutas de medios se resuelven usando el juego de la sala autorizada.
4. Para otro título PSX, reutilizar las correcciones de escritura de ArrayBuffer y descubrimiento de BIOS presentes en crash-bash.js cuando corresponda. Elegir un gameID propio; conservar nombre e ID de Crash Bash para sus guardados. No cambiar su versión 4.2.3 ni opciones de multitap.
5. Verificar rechazo de juegos inválidos/deshabilitados, permisos, invitación/aceptación y transmisión generada. Después probar manualmente disco y BIOS de la edición correcta, mandos, guardados, modo multijugador y una sesión completa entre equipos.

Crash Team Racing tiene adaptador y resolver propios. Aparece disponible cuando CTR_GAME_PATH y CTR_SBI_PATH apuntan a archivos existentes. Su compatibilidad se valida manualmente. Un juego nuevo compatible reutiliza autenticación, salas, plazas, señalización, captura y controles; no se copian estos servicios.

## Compatibilidad de API

POST /api/games/invitations recibe {targetId,gameId}. La ruta antigua /api/games/crash/invitations se mantiene como alias para Crash Bash. Los archivos siguen restringidos al anfitrión. Las salas son efímeras; al reiniciar se crean con el nuevo contrato, sin migraciones de cuentas o mensajes.

## Prueba manual

Reiniciar NSM, recargar ambas cuentas, abrir Juegos y seleccionar Crash Bash. Invitar desde el chat, aceptar con la otra cuenta y pulsar Jugar en el anfitrión. Comprobar aventura, controles y guardados existentes. Las pruebas automatizadas con canvas generado no verifican una partida real.


Las salas pueden crearlas todas las cuentas autenticadas. El navegador del creador ejecuta y comparte el juego; los invitados conservan las restricciones de acceso a medios y señalización. No se puede pertenecer a una segunda sala simultáneamente.
