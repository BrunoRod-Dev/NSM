# Prueba cerrada con cuatro personas

Esta prueba requiere personas y dispositivos reales. No se considera completada por ejecutar cuatro pestañas automáticas.

## Preparar la red local

1. Iniciá Docker Desktop y PostgreSQL con `npm.cmd run db:up`.
2. Elegí una computadora anfitriona. Consultá su dirección IPv4 en la red local, por ejemplo `192.168.1.50`.
3. Configurá `APP_ORIGIN=http://192.168.1.50:4200` en `.env` y reiniciá `npm.cmd run dev`. Usá esa misma dirección para entrar, también desde la anfitriona.
4. Angular escucha en `0.0.0.0:4200`. Si Windows pide acceso de red, limitá la autorización a tu red privada. El servidor y PostgreSQL pueden seguir escuchando en loopback: Angular redirige las solicitudes.
5. Generá cuatro invitaciones con `npm.cmd run invite`, una por persona, y compartilas por privado.

Este modo HTTP es exclusivamente para una prueba en una red privada confiable con contraseñas de prueba. Para conexiones por internet o redes no confiables, prepará HTTPS y una instalación apropiada. No abras PostgreSQL a la red ni configures reenvío público de puertos para esta prueba.

## Recorrido

1. Cada persona crea su cuenta y guarda su código de recuperación.
2. Se agregan por nombre de usuario y aceptan las solicitudes.
3. Dos personas conversan entre sí mientras las otras dos mantienen otra conversación. Comprueben que no se mezclan mensajes.
4. Una persona abre una segunda pestaña. Al cerrar la primera, debe seguir figurando conectada. Al cerrar la última, debe pasar a desconectada después del plazo de detección.
5. Una persona corta el Wi-Fi. Su interlocutor envía mensajes. Al reconectar, deben aparecer en orden y sin duplicados. Si un envío propio queda sin confirmar, usar «Reintentar envío».
6. Abran varias conversaciones, muévanlas, minimicen, vuelvan a abrir y recarguen. El historial confirmado debe mantenerse.
7. Bloqueen a un contacto con una conversación abierta. Ambos deben perder la posibilidad de enviar, conservando lo anterior. Desbloquear no debe restaurar la amistad automáticamente.
8. Detengan y vuelvan a iniciar el servidor. Comprueben que se recuperan la sesión, los amigos y el historial.
9. En una cuenta de prueba, usen recuperación. Verifiquen que las pestañas anteriores pierden acceso y guarden el código nuevo.
10. Repitan un intercambio desde celular en vertical y horizontal. Abran el teclado y comprueben que el botón «Enviar» siga visible. Vuelvan a amigos, abran otro chat y regresen: el borrador debe conservarse. Enter agrega una línea en pantallas compactas.
11. En computadora, reduzcan el tamaño de la ventana y prueben zoom de 125 % y 150 %. Maximicen y restauren una conversación; muévanla hacia el borde inferior. El cuadro de escritura y la barra de tareas deben quedar accesibles. Recorran controles con Tab para verificar que la ventana enfocada quede al frente.

## Registrar el resultado

Anoten fecha, navegadores, dispositivos y red utilizada. Para cada fallo: acción, resultado esperado, resultado observado y si se repite. Eviten incluir contraseñas, códigos o contenido privado en capturas.

La prueba está aprobada cuando las cuatro personas completan el recorrido sin pérdida de mensajes confirmados, duplicados ni acceso a conversaciones ajenas. Esta prueba evalúa funcionamiento; no es una medición de capacidad ni una auditoría de seguridad.
