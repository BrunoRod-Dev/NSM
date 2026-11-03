# Validación local — 3 de noviembre de 2026

## Entorno

- Windows, Node.js 24.13.1 y npm 11.8.0.
- Angular 21.2.26 y PostgreSQL 17.7 en Docker.
- Chrome instalado en el equipo para las pruebas de navegador.
- Base de pruebas separada de la base de la aplicación.

## Resultados

- Compilación de producción y comprobación de TypeScript: correctas, sin advertencias del proyecto.
- Integración del servidor: 15 pruebas aprobadas contra PostgreSQL, sesiones y conexiones reales. Incluyen invitaciones a jugar, cuatro plazas, permisos, protección de juego/BIOS y revocación por bloqueo o salida.
- Navegador: 5 pruebas aprobadas. Registro, recuperación inicial, amistad y chat entre dos contextos independientes; ventanas, texto seguro, cortes de red, bloqueo, historial y vista móvil comprobados. La prueba de juegos verificó WebRTC real con canvas/audio generados, entrada y liberación de controles, reconexión y cierre.
- Identidad visual: icono SVG compartido de dos personas cabeza abajo, favicon y carga de estilos comprobados en navegador.
- Dependencias de producción: `npm audit --omit=dev` no reportó vulnerabilidades conocidas en la revisión realizada. Esto no equivale a una auditoría de seguridad completa.
- Vista de desarrollo: interfaz, ruta de salud con acceso a PostgreSQL y SVG responden correctamente mediante el proxy de Angular.

Se inspeccionaron capturas de acceso, escritorio con chat, contactos y conversación móvil. Las capturas están en `.local/screenshots/`, excluidas de Git.

## Primera mejora visual con Astra

Se mantuvieron paleta, biseles e icono de NSM. La revisión y la primera implementación visual se realizaron con Astra; se integraron mejoras de contención de ventanas, navegación y foco, texto y controles, opciones de contacto y avisos de conexión.

La prueba de usabilidad cubre 1280 × 650, 320 × 568, 844 × 390 y 390 × 460 px. Verifica ventanas y botón de envío dentro del espacio disponible, maximizar/restaurar, regreso a amigos, conservación del borrador entre conversaciones, restauración del tamaño al volver a escritorio y posición de lectura al cargar historial. La altura reducida aproxima espacio de teclado, pero no prueba un teclado virtual físico.

## Prueba pendiente

La integración con el emulador real necesita comprobación del usuario. El primer intento automático detectó que la política del iframe bloqueaba scripts blob del emulador. Se corrigió esa política únicamente dentro de la ventana del juego y se recompiló. No se declara verificado el arranque real posterior a esa corrección ni una ronda de Crash Bash; el usuario decidió realizar esa prueba. La prueba generada no sustituye el juego original.

Falta la prueba con cuatro personas en dispositivos y redes reales. Seguir `docs/prueba-con-amigos.md`. La validación automática no mide capacidad de usuarios simultáneos ni sustituye esa prueba.

## Referencias verificadas

- [Compatibilidad de Angular](https://angular.dev/reference/versions).
- [Servidor de Fastify](https://fastify.dev/docs/latest/Reference/Server/).
- [Inicialización de Socket.IO](https://socket.io/docs/v4/server-initialization/).
- [Garantías de entrega de Socket.IO](https://socket.io/docs/v4/delivery-guarantees/).
- [Transacciones de node-postgres](https://node-postgres.com/features/transactions).


## Mejora de ventana de juego y mandos

- Compilación correcta y 15 pruebas de servidor aprobadas, incluyendo prohibición de descargar SBI desde una cuenta invitada.
- Prueba de navegador aprobada: Jugar inicia y comparte automáticamente; video remoto sin controles nativos; teclado invitado, mando estándar simulado con pulsación/liberación en plaza 2, reconexión y cierre.
- Prueba con archivos reales: emulador iniciado, video remoto de 900×557 y pistas de audio/video activas. Esto no equivale a haber completado una ronda ni a haber comprobado físicamente el mando Bluetooth.
- SBI local SCES-02834: SHA-256 `902f92b263d9a76e641d1c227fe1913eb09e402c855fb15493da2a2f4eba48b5`.


Corrección posterior de compatibilidad: los registros reales confirman BIOS reconocida y disco `[+chd][+sbi]`; antes se ejecutaba HLE y el SBI quedaba vacío. Se llegó a selección de dos personajes y cinemática de aventura. La entrada al mundo 1 y una partida completa quedan pendientes de prueba por el usuario, que solicitó detener la prueba interactiva del agente. No se afirma resuelto el bloqueo hasta esa comprobación.
