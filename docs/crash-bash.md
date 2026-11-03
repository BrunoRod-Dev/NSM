# Crash Bash dentro de NSM

## Primera integración

La cuenta `admin` ejecuta el juego en la PC que tiene instalado NSM. Hasta tres amigos aceptan invitaciones desde sus cuentas. El anfitrión usa EmulatorJS 4.2.3; los invitados reciben video y audio mediante WebRTC y envían sus controles por DataChannel.

Esto conserva el funcionamiento del proyecto original. No convierte el emulador en un juego con simulación propia en el servidor.

## Configuración local

En `.env`:

```text
CRASH_PROJECT_DIR=C:/Users/bruno/Desktop/crash bash project
CRASH_HOST_USERNAME=admin
```

NSM lee el `.chd`, la BIOS `.bin` y `runtime/loader.js` desde esa carpeta. No copia el juego ni la BIOS al repositorio. La cuenta anfitriona está restringida explícitamente: ser amigo o recibir una invitación no permite descargar esos archivos.

Si el servidor ya estaba abierto al cambiar `.env`, reinicialo con `npm.cmd run dev`. No hace falta iniciar `Jugar-online.cmd` para esta integración. Las salas de ese programa son independientes de las de NSM.

## Jugar

1. Abrí NSM con Admin y agregá a tus amigos.
2. Abrí una conversación y pulsá **Invitar a jugar**. Se abre la ventana de juegos y tu amigo recibe una invitación.
3. El amigo pulsa **Ver invitaciones** y **Aceptar partida**. Se reserva una plaza hasta cinco minutos antes de aceptar; hay cuatro plazas en total contando al anfitrión.
4. Admin pulsa **Iniciar juego** y espera la primera carga del emulador. Necesita acceso al CDN de EmulatorJS.
5. Cuando el juego haya arrancado y tenga audio, pulsa **Compartir juego**. Si no se detecta el audio directo, la alternativa **Usar audio de pestaña** permite elegir la pestaña y compartir su audio.
6. Dentro de Crash Bash, seleccioná el modo para varios jugadores. La conexión no cambia automáticamente el modo del juego.
7. Los invitados hacen clic en la imagen. WASD mueve; Numpad 4/8/6/2 son cuadrado/triángulo/círculo/cruz. Enter es Start. El botón **Activar sonido** habilita la reproducción de audio.
8. **Amigos y chat** trae NSM adelante conservando la ventana del juego. **Crash Bash** en la barra inferior vuelve a la partida. Mantené esta pestaña abierta.
9. **Reconectar jugador** renegocia la conexión del invitado sin cambiar su plaza mientras la sesión siga vigente.
10. **Terminar partida** desde Admin finaliza la sala para todos. Cada invitado puede salir sin cerrar la sala del anfitrión.

Para dos cuentas en la misma PC, usá una ventana normal y otra de incógnito, o navegadores distintos. Dos pestañas normales comparten la sesión de NSM.

## Permisos y duración

- Solo la cuenta anfitriona configurada inicia partidas. Las invitaciones se dirigen a amigos concretos y requieren aceptación.
- El servidor impone identidad, plaza, destinatarios y tipo de señal. No se confía en el remitente indicado por el navegador.
- Bloquear o eliminar una amistad cancela las invitaciones entre esas personas. Si ambas están en una partida, se termina la sala compartida.
- Cerrar sesión o recuperar la cuenta libera su participación; si era el anfitrión, termina la sala.
- Hay 90 segundos de tolerancia para el anfitrión y 45 para invitados sin actividad. Las salas viven en memoria y se cierran al reiniciar el servidor; no se pierden las conversaciones del chat.
- Una segunda ventana del anfitrión reemplaza el control de transmisión de la anterior. Evitá abrir el mismo juego dos veces.
- El iframe del emulador tiene una política de scripts específica para su ejecución; la política principal de NSM mantiene sus restricciones.

## Guardados

Los guardados quedan en el navegador anfitrión. NSM usa un origen distinto de `localhost:3000`, por lo que los guardados del proyecto original no aparecen automáticamente. La ventana simplificada no ofrece importación/exportación de estados; conservá una copia en el emulador anterior. No borres los datos del navegador sin exportarlos.

## Internet y controles

Esta entrega es local y no publica NSM. Para jugar desde otras redes, todos deben poder acceder a la misma instalación de NSM mediante HTTPS. El túnel anterior al puerto 3001 no publica el chat ni estas salas.

WebRTC usa STUN por defecto. Redes restrictivas pueden requerir TURN; se admite `RTC_ICE_SERVERS` como JSON de configuración STUN/TURN. Las credenciales solo se entregan a miembros autenticados de la sala. No se contrató un servicio ni se configuraron credenciales externas.

La primera integración recomienda PC con teclado. Se agregaron mandos remotos; no hay controles táctiles. El rendimiento, el audio escuchado, el efecto de perder foco y una ronda de cuatro jugadores deben comprobarse en los equipos reales; no se promete latencia.

## Pruebas reproducibles

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
npm.cmd run test:game:real
```

Las pruebas habituales usan una fuente de canvas y audio generados, claramente identificada, para verificar invitaciones, WebRTC, entrada y liberación de controles, reconexión y cierre sin depender del disco ni del CDN. La prueba `test:game:real` es optativa y usa los archivos configurados para comprobar arranque y recepción de video del emulador real entre navegadores locales. No sustituye una ronda entre personas.

Se reutilizaron `input-state.js`, `emulator-capture.js` y `rtc-metrics.js` del proyecto original. El cliente de partida adapta su captura/señalización a las sesiones y permisos de NSM; el proyecto original permanece sin modificaciones.

Referencias: [opciones de EmulatorJS](https://emulatorjs.org/docs/options/), [PlayStation en EmulatorJS](https://emulatorjs.org/docs/systems/playstation/), [RTCPeerConnection](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection).


## Ventana de juego y controles (actualización)

Admin pulsa **Jugar**. Al iniciar el emulador, NSM intenta compartir imagen y audio automáticamente; si el audio tarda, reintenta durante 20 segundos. Las opciones de recuperación quedan en **Controles → Conexión**. El invitado activa el sonido con un clic por las restricciones de reproducción del navegador. No se muestran controles nativos de video ni menús técnicos de EmulatorJS.

**Controles** permite elegir teclado o mando conectado y reasignar teclas/botones. El esquema estándar Xbox usa A/B/X/Y como cruz/círculo/cuadrado/triángulo, cruceta o stick izquierdo para moverse y Menu como Start. Cada ventana controla solamente su plaza; al perder foco, abrir el panel o desconectar el mando se liberan los botones. En una PC con dos ventanas, el mando controla la ventana enfocada. Para jugar simultáneamente con un único mando, hace falta otra persona con su propio dispositivo/ventana enfocada.

La transmisión pide hasta 6 Mbps y 50 cuadros por segundo, conservando resolución cuando el navegador lo permite. Es una preferencia del codificador; no garantiza calidad idéntica ni ausencia de pérdidas en cualquier red.

### Datos complementarios del disco europeo

`CRASH_SBI_PATH` permite proporcionar el archivo SBI que corresponde a la edición local. Solo el anfitrión autenticado puede descargarlo; se coloca en `/game.sbi` junto a `/game.chd` en el sistema de archivos del emulador. El disco original no se modifica.

En esta instalación se configuró `.local/crash-compat/SCES_028.34.sbi` (452 bytes), obtenido de PSX Data Center, entrada SCES-02834: https://psxdatacenter.com/sbifiles.html. Contiene metadatos de subcanales, no el juego ni una BIOS. No se incluye en el repositorio. La variable debe apuntar al archivo correcto en cada instalación y requiere reiniciar el servidor.


### Corrección de carga del emulador 4.2.3

El diagnóstico interno detectó `No BIOS files found`, ejecución con HLE y `SBI: parse failure at 0x0`. El cargador externo de 4.2.3 entregaba un `ArrayBuffer` a `FS.writeFile`, que necesita una vista de bytes; el SBI quedaba vacío. El adaptador de NSM normaliza ese tipo antes de escribir. También expone los mismos bytes de OpenBIOS como `/scph5502.bin`, un nombre reconocido por PCSX-ReARMed, sin modificar la BIOS original. Los registros posteriores confirman `found BIOS file`, imagen `[+chd][+sbi]` y detección de la clave de LibCrypt. Esos registros validan la carga, no por sí solos una partida completa.
