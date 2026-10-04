# UniFood

La carpeta principal elegida para este equipo es `C:\Users\credi\Documents\UniFood`.
Abrir `UniFood.code-workspace` desde esta carpeta para continuar el proyecto en otra sesión.
La copia de `OneDrive\Desktop\UniFood` es independiente y no recibe estos cambios.

## Iniciar siempre la misma aplicación

En Windows, abrir `iniciar-unifood.cmd` de esta carpeta. El archivo inicia el proyecto desde su propia ubicación, aunque se abra desde otra ventana o un acceso directo.

También se puede ejecutar:

```powershell
Set-Location C:\Users\credi\Documents\UniFood
npm run dev
```

El frontend se inicia en el puerto **3000** y escucha en todas las interfaces de red:

- En este equipo: `http://localhost:3000`.
- En otro dispositivo de la misma red: `http://<IP-LAN-del-PC>:3000`.

Las dos direcciones sirven los mismos archivos. La entrada `/` redirige a `/login`, con inicio de sesión y registro de estudiantes. Reiniciar el servidor o cerrar esta sesión de trabajo no elimina los cambios guardados.

Al iniciar se imprimen la carpeta activa y las direcciones reales de cada interfaz; para un celular conectado al Wi-Fi usar la dirección `En red (Wi-Fi)`. El servidor escucha en `::` para atender tanto IPv6 (`localhost` / `::1`) como IPv4 (`127.0.0.1` y la IP de Wi-Fi). `::`, que Next.js puede mostrar, es la dirección de escucha y no la dirección que se debe abrir en el celular.

El puerto se fija explícitamente: si otra copia está usando 3000, el inicio muestra un error en lugar de cambiar silenciosamente a 3001. Detener la instancia anterior antes de volver a iniciar. La IP de red puede cambiar al cambiar de Wi-Fi o por DHCP; usar la IP actual del equipo.

Para desarrollar, usar `npm run dev`, que refleja los cambios guardados. `npm run start` sirve la compilación de producción: ejecutar antes `npm run build` para actualizarla.

Las dependencias del frontend se instalan con `npm --prefix unifood-web ci`. La configuración del backend y de Supabase se explica en [unifood-web/README.md](unifood-web/README.md) y [autenticación](unifood-web/docs/auth.md).
