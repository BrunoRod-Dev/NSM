# Despliegue con una IP pública

Para publicar sin depender de un dominio, configurar `production.env`:

```dotenv
NSM_DOMAIN=45.155.125.130
CADDY_CONFIG=./deploy/Caddyfile.ip
```

Conservar las demás variables privadas del despliegue. Aplicar con:

```sh
docker compose --env-file production.env -f compose.production.yaml up -d
```

Esta configuración usa certificados públicos de Let's Encrypt con el perfil
`shortlived`. Caddy los renueva automáticamente; mantener persistente el volumen
`caddy-data` y accesibles los puertos públicos 80 y 443. `default_sni` permite
seleccionar el certificado cuando el navegador abre directamente la IP.

El origen de la aplicación será `https://45.155.125.130`, incluidas las cookies
seguras y las conexiones de chat. No hace falta desactivar las protecciones del
navegador ni aceptar certificados autofirmados.

Cuando el dominio resuelva correctamente, cambiar `NSM_DOMAIN` al dominio,
quitar `CADDY_CONFIG` y volver a ejecutar el comando. Las sesiones corresponden
al origen utilizado, por lo que habrá que iniciar sesión nuevamente.
