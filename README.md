# NSM — Nostalgic Simple Messenger

Mensajero privado inspirado en Windows 2000. Cuentas por invitación, amigos, presencia, texto privado y recuperación de conversaciones. Primera integración de Crash Bash mediante invitaciones desde el chat. Todo funciona localmente con PostgreSQL real.

El icono propio de NSM son dos amigos cabeza abajo, siguiendo el boceto original. El SVG compartido en `apps/web/public/nsm-icon.svg` se usa en acceso, ventanas, escritorio, barra de tareas y favicon.

## Requisitos

- Node.js 24 LTS y npm. El proyecto usa Angular 21, compatible con el Node 24 instalado.
- Docker Desktop iniciado, con contenedores Linux, o un PostgreSQL 17 propio.
- Chrome para las pruebas de navegador incluidas. La aplicación no requiere instalar Chrome específicamente.

## Primer arranque

Desde la raíz del proyecto, en PowerShell:

En Windows usamos `npm.cmd` para ejecutar npm directamente, incluso cuando PowerShell bloquea `npm.ps1`. No hace falta cambiar la política de ejecución del equipo.

```powershell
npm.cmd ci
Copy-Item .env.example .env
npm.cmd run db:up
npm.cmd run db:migrate
npm.cmd run invite
npm.cmd run dev
```

Si ya existe `.env`, conservá su configuración en lugar de reemplazarla. Las credenciales de `.env.example` son exclusivamente para desarrollo local.

Abrí **http://localhost:4200**. En «Crear cuenta», usá la invitación que muestra el comando. Guardá el código de recuperación antes de entrar. No se pide correo.

Para invitar a otra persona, ejecutá otra vez `npm.cmd run invite`. Cada invitación permite crear una sola cuenta y vence a las 72 horas. Para elegir un vencimiento de 24 horas:

```powershell
npm.cmd run invite -- 24
```

El código se muestra únicamente al generarlo. El servidor guarda su hash, no el código. Compartilo por un medio privado. El comando no dispone de una pantalla pública ni de una ruta administrativa accesible por internet.

Angular escucha en el puerto 4200; redirige `/api` y `/socket.io` al servidor local del puerto 4301. PostgreSQL escucha solo en `127.0.0.1:54329`. No se publicaron servicios externos.

## Usar la versión compilada

```powershell
npm.cmd run build
```

Para que el servidor sirva la interfaz compilada, cambiá `APP_ORIGIN` en `.env` a `http://localhost:4301` y ejecutá:

```powershell
npm.cmd start
```

Abrí **http://localhost:4301**. Volvé a `APP_ORIGIN=http://localhost:4200` cuando uses `npm.cmd run dev`.

`NODE_ENV=production` activa cookies Secure y otras protecciones: requiere HTTPS y un origen exacto configurado. No es un interruptor para exponer directamente el servidor local. Antes de una publicación faltan configurar HTTPS, copias de seguridad, monitoreo, política de conservación/borrado y el tratamiento de denuncias.

## Comandos

- `npm.cmd run dev`: interfaz y servidor con recarga durante el desarrollo.
- `npm.cmd run db:up`: inicia PostgreSQL y espera a que esté listo.
- `npm.cmd run db:down`: detiene PostgreSQL conservando el volumen de datos.
- `npm.cmd run db:migrate`: aplica migraciones pendientes. El arranque del servidor también las aplica.
- `npm.cmd run invite -- [horas]`: genera una invitación de un uso; entre 1 y 720 horas.
- `npm.cmd run check`: comprueba tipos del servidor y los contratos.
- `npm.cmd run build`: comprueba el servidor, compila Angular con plantillas estrictas y genera el servidor distribuible.
- `npm.cmd test`: pruebas de integración contra PostgreSQL separado.
- `npm.cmd run test:e2e`: pruebas reales en Chrome; requiere ejecutar `npm.cmd run build` antes.

## Organización

```text
apps/
  web/src/app/
    accounts/       acceso, recuperación y sesión
    core/           cliente HTTP
    friends/        amigos, solicitudes y bloqueos
    messenger/      conexión única, sincronización y ventanas de chat
  server/
    src/
      accounts/     contraseñas, invitaciones y sesiones
      friends/      reglas de amistad y permisos de contacto
      messages/     persistencia, orden y reintentos
      presence/     conexiones por cuenta y detección de desconexión
    migrations/     SQL versionado con comprobación de integridad
    test/           pruebas de integración y WebSocket
packages/contracts/ solicitudes, respuestas, eventos y validadores compartidos
e2e/                 recorridos de navegador
scripts/             servidor aislado para las pruebas de navegador
docs/                decisiones y prueba manual
```

La primera integración de Crash Bash está en el módulo `games`: la cuenta `admin` ejecuta el emulador y hasta tres amigos se conectan por WebRTC. [Guía para jugar y configurar](docs/crash-bash.md). Los archivos del juego permanecen en la carpeta original y no se copiaron al repositorio.

## Lectura y navegación

- En computadora, las conversaciones se pueden mover, minimizar, maximizar y restaurar. Sus límites reservan la barra inferior para que el cuadro de escritura siga dentro de pantalla.
- En pantallas de hasta 900 px se muestra una conversación a la vez. «← Amigos» vuelve a contactos sin perder el borrador; abrir otra conversación conserva las anteriores.
- «NSM Messenger» o «Amigos» en la barra inferior trae contactos al frente. También se activa la ventana al navegar por teclado.
- Al pasar de escritorio a una pantalla compacta y volver, se recuperan el tamaño y la posición anteriores de las conversaciones.
- «Contacto» y «Más» agrupan opciones de eliminar y bloquear, con confirmación. Escape cierra los menús desplegados.
- En computadora, Enter envía y Shift + Enter agrega una línea. En pantallas compactas, Enter agrega una línea y el botón «Enviar» confirma el envío.
- La conversación muestra presencia, estado de conexión y avisos sin tener que volver a contactos. Cargar historial anterior conserva el lugar de lectura.

La altura usa el viewport visible cuando el navegador lo informa. Aun así, el teclado virtual y las áreas seguras deben comprobarse en dispositivos reales; la emulación de navegador no reproduce todos sus comportamientos.

## Datos y funcionamiento

- Usuarios: entre 3 y 24 letras ASCII, números o guiones bajos. Se recortan espacios exteriores y se comparan en minúsculas. Un identificador UUID interno conserva la identidad aunque cambie el nombre visible.
- Contraseñas: entre 12 y 128 caracteres al registrar o recuperar; Argon2id. No se implementa criptografía propia.
- Sesiones: token aleatorio de 256 bits, hash en PostgreSQL, cookie HttpOnly y SameSite=Strict. Duran 7 días por defecto. Cerrar sesión invalida esa sesión y sus pestañas; recuperar la cuenta invalida todas las anteriores.
- Recuperación: código aleatorio de 256 bits, almacenado como hash. Cada recuperación rota el código. Perder contraseña y código puede significar perder la cuenta.
- Amigos: la solicitud necesita aceptación. El bloqueo es efectivo para ambas direcciones y quita la amistad. Desbloquear no la restablece.
- Presencia: varias pestañas cuentan como una misma persona. Hay 3 segundos de gracia tras cerrar la última conexión. Un corte de red puede tardar además el intervalo de detección de WebSocket; la presencia no es instantánea.
- Mensajes: hasta 2000 caracteres. Se confirma «enviado» solo después de guardar. No hay confirmación de lectura. El orden pertenece al servidor y los reintentos reutilizan el identificador original.
- Historial: paginación por secuencia, entrega al volver y sincronización tras reconectar. Se conserva después de eliminar o bloquear un contacto. En esta prueba cerrada permanece en PostgreSQL; todavía no hay borrado desde la interfaz.
- Texto seguro: los mensajes se muestran como texto, sin interpretar HTML. Los mensajes están protegidos en tránsito cuando se configure HTTPS, pero **no hay cifrado de extremo a extremo**; quien administra la base puede acceder al contenido.
- Los envíos sin confirmar se mantienen en memoria mientras la pestaña esté abierta. Se advierte al salir con pendientes. Recargar o cerrar puede perder el reintento local; el historial confirmado permanece.

Los eventos se dirigen exclusivamente a las conexiones autenticadas de los participantes. El cliente no elige salas ni identidad. Se comprueban sesiones, participación y amistad en el servidor. Bloqueos y envíos se serializan por par de usuarios dentro de transacciones.

## Pruebas automáticas

`TEST_DATABASE_URL` debe apuntar a una base exclusiva, distinta de la de la aplicación, cuyo nombre termine en `_test`. Las pruebas crean esa base si el usuario tiene permisos; en instalaciones con menos privilegios, debe crearla el administrador. No borran la base de la aplicación.

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

Las pruebas del servidor comprueban invitaciones concurrentes, recuperación, límites de acceso, permisos, bloqueos, reintentos, paginación, presencia y persistencia al reiniciar.

Las pruebas de navegador abren contextos independientes para registrar dos personas, agregarlas y conversar; comprueban texto seguro, ventanas, reconexión, bloqueo y uso móvil. Usan Chrome instalado. Para usar otro navegador, cambiá `channel` en `playwright.config.ts` e instalá el navegador correspondiente mediante Playwright.

Las capturas locales quedan en `.local/screenshots/`. Los diagnósticos de fallos se guardan en `test-results/`. Ambos se excluyen del control de versiones.

La guía para probar con cuatro personas está en [docs/prueba-con-amigos.md](docs/prueba-con-amigos.md). Las sesiones automáticas no sustituyen esa prueba en distintos dispositivos y redes.

## Alcance y límites

Esta versión está preparada para una prueba cerrada. Incluye la integración inicial de Crash Bash, pendiente de una ronda real entre personas. No incluye aplicaciones descargables, directorio público, reportes ni un panel administrativo. El bloqueo y los límites de solicitudes/mensajes están implementados.

Se usa una sola instancia del servidor. La presencia y los presupuestos de eventos en tiempo real viven en esa instancia; cuentas, sesiones, invitaciones, amistades y mensajes viven en PostgreSQL. Múltiples instancias requieren coordinación adicional. No se ha medido ni se promete una capacidad de usuarios simultáneos.

Los límites HTTP se aplican por IP, por lo que varias personas en una misma red comparten presupuesto. Los límites de mensajes se aplican por cuenta, compartidos entre pestañas. No habilites `trustProxy` sin definir qué proxy es confiable.

Docker conserva los datos en un volumen. Eso no reemplaza una copia de seguridad. No elimines ese volumen si querés conservar las cuentas y conversaciones.


Preparación de hosting y flujo de salas: [Guía de beta online](docs/online.md).
