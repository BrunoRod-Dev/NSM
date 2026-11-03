# Decisiones del hito 1

- Angular 21 y Node 24: combinación estable compatible con el entorno disponible, sin actualizar herramientas globales.
- Un repositorio y una instalación de dependencias: interfaz, servidor y contratos comparten tipos sin introducir orquestación adicional.
- Fastify atiende HTTP y el mismo servidor HTTP aloja Socket.IO. Desarrollo usa un proxy de Angular; compilado puede funcionar desde un único origen.
- La compilación desactiva CSS crítico asíncrono: Angular puede generar atributos `onload` en enlaces de estilo que la política de seguridad bloquea. Se carga la hoja de estilo directamente, manteniendo la restricción sobre scripts inline.
- Se fija una actualización de `glob` y `minimatch` mediante overrides compatibles con el uso de archivos estáticos; el lockfile conserva las versiones verificadas. Al actualizar el plugin, revisar si los overrides siguen siendo necesarios.
- No se habilita CORS general. Las operaciones que cambian datos verifican el origen exacto; las cookies son SameSite=Strict. El WebSocket verifica origen y sesión al conectar y la vuelve a comprobar al enviar.
- Los tokens aleatorios de sesión, invitación y recuperación se almacenan como SHA-256: su alta entropía permite este uso. Las contraseñas humanas usan Argon2id con sal administrada por la biblioteca.
- Registro e invitaciones comparten una transacción y bloqueo de fila. Un registro fallido no consume la invitación.
- Recuperación bloquea la cuenta, cambia credenciales y revoca sesiones en una transacción. El acceso comprueba que la contraseña no haya cambiado mientras se verificaba.
- Cada par de usuarios tiene un bloqueo transaccional común para amistad, bloqueo y mensajes. Un envío posterior al bloqueo no conserva permisos antiguos por tener una ventana abierta.
- Cada conversación tiene una secuencia propia asignada en PostgreSQL. La clave única de remitente + identificador de envío permite reintentar. Reutilizar esa clave con otro contenido produce conflicto.
- Las confirmaciones y emisiones ocurren después del commit. Si se corta la conexión, el cliente recupera el historial por cursor; no se depende de que Socket.IO almacene los mensajes.
- El servidor puede leer mensajes persistentes. El hito no implementa cifrado de extremo a extremo ni promueve esa promesa.
- El historial sigue disponible para sus participantes después de quitar amistad o bloquear. La conservación y el borrado definitivo deben resolverse antes de ampliar la prueba.
- La presencia es temporal, compartida entre pestañas y visible solo para amigos autorizados. Reiniciar el servidor obliga a reconstruirla mediante las conexiones.
- No se suman Redis ni servidores distribuidos sin mediciones. El servidor de partidas se evaluará por separado en el hito 2.
