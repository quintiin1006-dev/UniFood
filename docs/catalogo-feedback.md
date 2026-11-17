# Catálogo de feedback de UniFood

Mapa de dónde aparece cada mensaje y estado de respuesta, por rol, pantalla y acción. Sirve para
revisar la «visibilidad del estado del sistema» (heurística 1 de Nielsen) antes de la demo del
28-nov-2026. Rutas relativas a `unifood-web/`. Auditado el 15-nov-2026 sobre `develop` + ola 4.

- **Textos:** la fuente única es `features/shared/messages.ts`: eventos de UI y un mensaje por
  cada `ErrorCode` del backend. `tests/messages-catalog.test.mjs` falla si el backend añade un
  código sin mensaje.
- **Revisión visual:** `/dev/feedback` reúne todos los estados con sus textos reales. Solo existe
  en desarrollo (en producción responde 404); ver `docs/ui-paneles.md`.
- **Leyenda de estados:** I inicial · C cargando · É éxito · E error · V vacío · SC sin conexión ·
  SV sesión vencida · SP sin permiso. ✅ cubierto · 🆕 cerrado en la ola 4 · ⚠️ hueco pendiente.

## Login, registro y recuperación

| Pantalla                             | Acción                | Estados                               | Texto actual                                                                             | Componente · archivo:línea                                   |
| ------------------------------------ | --------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `/login`, `/panel/login`             | Iniciar sesión        | C 🆕 · E ✅ · SC ✅                   | «Entrando…» con spinner; el formulario permanece hasta llegar al destino                 | `AuthScreen` · `features/auth/components/AuthScreen.tsx:102` |
| `/login`, `/panel/login`             | Error de credenciales | E ✅ (junto al campo, `role="alert"`) | Mensaje del catálogo de auth                                                             | `AuthScreen.tsx:600`                                         |
| Login → panel                        | Redirección por rol   | C 🆕                                  | Sin pantallas intermedias: `router.replace` con `prefetch`; se eliminó `app/loading.tsx` | `AuthScreen.tsx` (`navigate`)                                |
| `/registro`, `/recuperar-contrasena` | Enviar                | C ⚠️                                  | «Un momento…» sin spinner                                                                | `AuthScreen.tsx:437`                                         |
| `/panel/recuperar`                   | Solicitar enlace      | É ✅ · E ✅                           | «Si existe una cuenta asociada…», «Demasiadas solicitudes…»                              | `features/panel-recovery/errors.ts`                          |

## Cliente

| Pantalla                    | Acción                        | Estados                                           | Texto actual                                                                              | Componente · archivo:línea                        |
| --------------------------- | ----------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Cambio de ruta en `/cuenta` | Navegar                       | C 🆕                                              | Loader de marca en línea, diferido 300 ms (cabecera y pestañas visibles)                  | `UniFoodLoader` · `app/cuenta/loading.tsx`        |
| Inicio, menú                | Cargar menú                   | E ✅ · E de código 🆕                             | «No pudimos cargar el menú»; `CLIENT_CATALOG_TEMPORARILY_UNAVAILABLE` tiene mensaje nuevo | `MenuUnavailable.tsx:11`                          |
| Tarjeta de producto         | Agregar al carrito            | É ✅ (inmediato, local) · deshabilitado ✅        | «+» → selector `− n +`; «Agotado», «Cerrada»                                              | `ProductAddButton.tsx:30`                         |
| Carrito                     | Quitar línea                  | É ✅ (inmediato)                                  | —                                                                                         | `CartLineItem.tsx:78`                             |
| Carrito                     | Vaciar o cambiar de cafetería | Confirmación ✅                                   | «Conservar carrito» / acción                                                              | `ConfirmDialog` · `ClientCartProvider.tsx:22`     |
| Resumen                     | Confirmar pedido              | C 🆕 (spinner) · E ✅ · SC ✅ (reintento) · SV ✅ | «Enviando pedido…», «Reintentar envío», mensajes por código                               | `ClientCheckout.tsx:330`                          |
| Resumen                     | Hora o nota inválidas         | E ✅ (junto al campo, foco)                       | `INVALID_PICKUP_TIME`, `ORDER_NOTE_TOO_LONG`                                              | `ClientCheckout.tsx`, `features/client/errors.ts` |
| Confirmación                | Pedido creado                 | É ✅ (título enfocado)                            | Pantalla de confirmación                                                                  | `CheckoutConfirmation.tsx:27`                     |
| Términos                    | Aceptar                       | C 🆕 (spinner) · E ✅                             | «Un momento…», «Aceptar y continuar»                                                      | `TermsGate.tsx:103`                               |
| Perfil                      | Cargar                        | E de código 🆕                                    | `CLIENT_PROFILE_NOT_FOUND`, `CLIENT_PROFILE_TEMPORARILY_UNAVAILABLE`: mensajes nuevos     | `features/shared/messages.ts`                     |
| Pedidos                     | —                             | —                                                 | Pestaña «Pedidos, próximamente» (sin funcionalidad en develop)                            | `ClientBottomNav.tsx`                             |

## Worker

| Pantalla          | Acción                 | Estados                                           | Texto actual                                                                            | Componente · archivo:línea                                   |
| ----------------- | ---------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Tablero           | Primera carga          | C 🆕 (esqueleto de 4 columnas, sin «Conectando…») | Encabezado sin texto hasta la primera lectura                                           | `BoardLoading` · `WorkerDashboard.tsx`                       |
| Tablero           | Sincronización         | É ✅ · SC ✅                                      | «Actualizado a las HH:MM», «Sin conexión. Reintentando…» y banner con los últimos datos | `listingStatus.ts:66`, `StaleListingBanner`                  |
| Tablero           | Sesión o permiso       | SV ✅ · SP ✅                                     | «Tu sesión terminó», «No pudimos abrir tu tablero»                                      | `listingErrorView` · `listingStatus.ts`                      |
| Tarjeta / detalle | Avanzar estado         | Optimista 🆕 · C 🆕 · E ✅ (reversión 🆕)         | La tarjeta pasa de columna al instante con «Guardando…»; si falla, vuelve y avisa       | `useOrders.ts:211`, `OrderCard.tsx:130`                      |
| Tarjeta           | Rechazar               | Confirmación ✅ (motivo) · E ✅ en el diálogo     | Motivo obligatorio, límite 200                                                          | `RejectOrderDialog.tsx:32`                                   |
| Columna           | Sin pedidos            | V ✅                                              | «No hay pedidos»                                                                        | `KanbanBoard.tsx:153`                                        |
| Búsqueda          | Sin resultados         | V ✅                                              | Mensaje con acción para limpiar                                                         | `SearchEmpty`                                                |
| Llamadas          | Entregar               | C ✅                                              | «Registrando entrega…»                                                                  | `CallsBoard.tsx:390`                                         |
| Llamadas          | No recogido            | Confirmación ✅ (segundo clic)                    | «Confirmar no recogido»                                                                 | `CalledOrderActions.tsx:123`                                 |
| Disponibilidad    | Abrir/cerrar, producto | Optimista ✅ · C ✅ · E ✅ (reversión)            | «Guardando…»                                                                            | `ProductCard.tsx:63`, `AvailabilityPanel.tsx:50` (esqueleto) |
| Perfil            | Cargar                 | C ✅ (esqueleto)                                  | —                                                                                       | `WorkerProfilePanel.tsx:20`                                  |

## Admin

| Pantalla       | Acción           | Estados                                          | Texto actual                                                            | Componente · archivo:línea                     |
| -------------- | ---------------- | ------------------------------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------- |
| Cambio de ruta | Navegar          | C 🆕                                             | Loader de marca en línea, diferido 300 ms (barra lateral visible)       | `app/admin/loading.tsx`                        |
| Dashboard      | Cargar período   | C ✅ (esqueleto con la forma del gráfico) · E ✅ | «Consultando el período seleccionado»                                   | `DashboardLoading.tsx:23`                      |
| Catálogo       | Guardar producto | C ✅ · É ✅                                      | «Guardando y verificando el resultado…», «Producto e imagen guardados.» | `ProductDrawer.tsx:434`, `AdminCatalog.tsx:91` |
| Catálogo       | Desactivar       | Confirmación ✅                                  | «¿Desactivar “…”?»                                                      | `ProductDrawer.tsx:267`                        |
| Catálogo       | Sin productos    | V ✅ (ícono genérico ⚠️)                         | —                                                                       | `AdminCatalog.tsx`                             |

## Super admin

| Pantalla   | Acción          | Estados      | Texto actual                                 | Componente · archivo:línea  |
| ---------- | --------------- | ------------ | -------------------------------------------- | --------------------------- |
| Cafeterías | Guardar ajustes | C ✅ · E ✅  | «Guardando…» y mensajes por código           | `CafeteriaSettings.tsx:124` |
| Panel      | Error de carga  | E ✅ · SV ✅ | Mensaje por código y enlace «Iniciar sesión» | `SuperAdminPanel.tsx:86`    |

## Huecos pendientes

1. Registro y recuperación: «Un momento…» sin spinner (`AuthScreen.tsx:437`). Pequeño, fuera de F2.
2. Éxito breve en el worker: el cambio de columna confirma, pero no hay toast de 2–3 s.
3. Íconos genéricos fuera de la navegación, el tablero y los encabezados: quedan 44 nombres de
   lucide en 43 archivos (eran 55); `grep -rl "lucide-react" app components features`.
4. Pedidos del cliente («próximamente»): sin feedback porque la funcionalidad no está en develop.
