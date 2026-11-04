# Metal Slug / Neo Geo

Estado: integración inactiva hasta disponer de archivos compatibles y verificar dos jugadores.

## Archivos privados

Configurar NEOGEO_PROJECT_DIR (producción: /games/neogeo, correspondiente
a /srv/nsm-games/neogeo del anfitrión Docker).

- Metal Slug: mslug.zip
- Metal Slug 2: mslug2.zip
- Metal Slug X: mslugx.zip
- Metal Slug 3: mslug3.zip
- Metal Slug 4: mslug4.zip
- Metal Slug 5: mslug5.zip
- BIOS compartida: neogeo.zip

Mantener nombres y archivos internos del conjunto FBNeo. Un conjunto de otra
versión de MAME no acredita compatibilidad. No descomprimir ni renombrar ROMs.

La versión fijada de EmulatorJS 4.2.3 resuelve arcade a FBNeo. NSM entrega la
BIOS intacta como /neogeo.zip mediante externalFiles y normaliza ArrayBuffer
a Uint8Array antes de escribirlo en el sistema de archivos del núcleo.

## Puerta de habilitación

Cada definición permanece enabled=false. Antes de habilitarla se requiere
auditar entradas, tamaños y CRC contra el DAT del núcleo exacto y ejecutar
una sesión aislada con dos entradas independientes, ficha y start por jugador.
Después registrar <set>.audit.json con core=emulatorjs-4.2.3-fbneo,
twoPlayerVerified=true y sha256 con claves <set>.zip y neogeo.zip.
Los hashes deben corresponder exactamente a los archivos ejecutados.
Este informe nunca se genera automáticamente por mera existencia de un ZIP.

## Otras plataformas

Advance corresponde a Game Boy Advance y ofrece campaña de un jugador.
Metal Slug 6 usa originalmente Atomiswave y también tiene versiones de consola.
Metal Slug 7 corresponde a Nintendo DS y es de un jugador.
XX corresponde a PSP y otras plataformas, con cooperativo que requiere
investigar la edición y su comunicación. No comparte el adaptador Neo Geo.

## Comprobación manual pendiente

Crear sala de un título habilitado, invitar desde la sala y aceptar con una
segunda cuenta. Probar Ficha y Start de cada jugador, mover a ambos a la vez,
y mantener dirección con Disparo y Salto en pantalla táctil.
Verificar PC anfitrión/iPhone invitado y después iPhone anfitrión.
