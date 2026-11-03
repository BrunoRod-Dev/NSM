# CTR — integración local

Edición configurada: Europe EDC, SCES-02105. El ZIP proporcionado contenía BIN/CUE, convertido con chdman de MAME 0.289 (distribución oficial mamedev/mame) a .local/ctr/ctr.chd. Se conserva el ZIP y los originales extraídos. No se incluye ningún disco o BIOS en el repositorio.

CTR_GAME_PATH apunta al CHD y CTR_SBI_PATH al SBI EDC de PSX Data Center (entrada SCES-02105 EDC en https://psxdatacenter.com/sbifiles.html), de 452 bytes. Son metadatos del disco, no otra copia del juego. Reutiliza la BIOS local y loader configurados mediante CRASH_PROJECT_DIR.

El adaptador PSX compartido conserva EmulatorJS 4.2.3, correcciones de ArrayBuffer y BIOS y multitap port 1. Crash Bash mantiene gameID 200011; CTR usa 200012 y nombre distinto para sus guardados. Se reutilizan salas, WebRTC y controles.

## Prueba manual

1. Reiniciar npm.cmd run dev para cargar las variables nuevas y recargar ambas ventanas.
2. Terminar cualquier partida anterior. En Juegos pulsar Crear sala de Crash Team Racing e invitar amigos desde el panel de la sala.
3. Aceptar con Admin2 y pulsar Jugar con Admin. Activar sonido en el invitado.
4. Elegir carrera multijugador o batalla dentro de CTR. Aventura es para un jugador.
5. Comprobar controles en ambas plazas, carrera completa, audio, reconexión y guardados. Probar cuatro plazas posteriormente.

Las pruebas automatizadas verifican identificación de juego, disponibilidad, acceso a medios e invitaciones; no acreditan una carrera real ni compatibilidad completa de CTR. La prueba manual queda a cargo del usuario.
