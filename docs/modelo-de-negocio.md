# Modelo de negocio: cargo por servicio

Estado: PR 1 (backend y base de datos) en la rama `jj/cargo-servicio`, detrás de
`SERVICE_FEE_ENABLED`. Reemplaza el modelo de cobro por cafetería de la fase 4
(`docs/propuesta-fase4-cobro.md`, migración 022). Si algo difiere de `docs/decisiones.md`, se
actualiza aquel documento al aprobar este modelo.

## 1. En una frase

UniFood cobra **al estudiante** un cargo fijo por pedido (inicial: **$300**). La cafetería lo
cobra en el mostrador junto con el pedido y gira a UniFood, cada mes, los cargos de los pedidos
entregados. La cafetería es el cliente comercial que acepta el modelo; ya no paga membresía ni
comisión.

## 2. Reglas

1. **Valor fijo** en pesos enteros, el mismo para todos los pedidos de una cafetería, sin
   excepciones ni descuentos. Rango 0 a 2.000, validado en Spring y con CHECK en la base.
2. **Configuración.** Un valor general (`service_fee_settings`, inicia en 300) y un valor
   opcional por cafetería (`cafeteria_service_fee`): `NULL` usa el general, `0` es sin cargo.
   Solo el super admin los cambia. Cada cambio queda en `service_fee_audit` (quién, cuándo,
   valor anterior y nuevo), sin sobrescribir.
3. **El servidor calcula todo.** Total = productos (plato del menú del día, productos y
   adiciones) + cargo. El navegador nunca calcula el cargo: lo recibe en la carta y en cada
   pedido.
4. **Instantánea inmutable.** `orders.service_fee_cop` se fija al crear el pedido y un trigger
   impide cambiarlo. Cambiar el valor después no altera pedidos ya creados. Los pedidos
   anteriores a la 033 y los creados con el flag apagado quedan con cargo 0.
5. **Transparencia.** La carta (`GET /api/me/menu?cafeteriaId=…`) trae `serviceFee`. El
   cliente envía `expectedServiceFee` en `POST /api/me/orders`. Si no coincide con el vigente, la
   respuesta es **409 `SERVICE_FEE_CHANGED`** («El cargo por servicio cambió. Revisa el total y
   confirma de nuevo.») con el valor vigente en `serviceFee`, y no se escribe nada. Sin
   `expectedServiceFee`, solo se acepta si el cargo vigente es 0.
6. **Solo cuentan los entregados.** `DELIVERED` suma a la liquidación. `CANCELLED` y
   `NOT_COLLECTED` conservan su valor guardado pero no suman. No hay penalización por no
   recoger en este alcance.
7. **Cobro en mostrador.** Sin pagos en línea: el worker ve «Total a cobrar» con el desglose y
   cobra total + cargo. La cafetería gira a UniFood los cargos del mes.
8. **Liquidación mensual** por cafetería. El mes de un cargo es el mes de `delivered_at` en
   America/Bogota (no el de `created_at`): un pedido creado el 31 a las 23:50 y entregado el 1
   a las 00:10 cuenta para el mes siguiente. El mes en curso se calcula en vivo
   (`service_fee_month_summary`, solo lectura). «Cerrar mes» congela el resumen en
   `service_fee_settlements`: un mes cerrado no se recalcula, cerrarlo dos veces no duplica
   (`UNIQUE (cafeteria_id, period_month)`), y un pedido es una sola fila, así que no puede sumar
   dos veces. Solo se cierra un mes ya terminado.
9. **Mora: solo registro y aviso.** Un mes cerrado que sigue `PENDIENTE` más de 10 días después
   de terminar se marca «Vencido», con el saldo y los días de atraso (desde el día 11). La
   constante es `ServiceFeeRules.SETTLEMENT_GRACE_DAYS`. No hay bloqueo de pedidos ni
   suspensión automática.
10. **Documento de cobro:** reporte en pantalla y CSV. La cuenta de cobro se emite por fuera
    del sistema.
11. **Acceso.** Super admin: todas las cafeterías, edita valores, cierra mes, marca pagada,
    descarga CSV. Admin de cafetería: solo la suya, en solo lectura (la cafetería sale de la
    base, nunca de la petición). Estudiante: el cargo es una línea más. Worker: el desglose.
12. **Auditoría** de cada cambio de valor, cierre de mes y marca de pago, por trigger, en la
    misma transacción. El SQL manual también queda registrado (`source = 'SQL'`, sin autor).

## 3. Ejemplo numérico

Cafetería Central, valor general $300, noviembre de 2026:

| Pedido | Productos | Cargo | Total a cobrar | Estado        | Cuenta para UniFood |
| ------ | --------: | ----: | -------------: | ------------- | ------------------- |
| A      |   $13.000 |  $300 |        $13.300 | DELIVERED     | Sí                  |
| B      |    $9.500 |  $300 |         $9.800 | DELIVERED     | Sí                  |
| C      |    $4.500 |  $300 |         $4.800 | CANCELLED     | No                  |
| D      |   $11.000 |  $300 |        $11.300 | NOT_COLLECTED | No                  |

- Ventas de productos de la cafetería (entregados): $22.500.
- Cargos del mes (a girar a UniFood): 2 × $300 = **$600**.
- Si el super admin sube el valor a $400 el 20 de noviembre, los pedidos A a D siguen en $300;
  solo los creados desde ese momento llevan $400.
- El 1 de diciembre se cierra noviembre: queda `PENDIENTE` con $600. Si el 11 de diciembre aún
  no está pagado, aparece «Vencido · 1 día de atraso».

## 4. Qué se deprecia de la membresía (022)

No se borra ningún dato ni columna.

- `cafeteria_billing_settings` y su historial en `cafeteria_settings_audit` quedan intactos.
  La tabla lleva el comentario «DEPRECATED by 033».
- Con `SERVICE_FEE_ENABLED` encendido, `PUT /api/super-admin/cafeterias/{id}/billing`
  responde **410 `BILLING_DEPRECATED`** sin escribir nada. Apagado, funciona como antes.
- El panel del super admin oculta el formulario «Cobro» y la columna «Cobro» con el flag
  encendido (PR 3). El listado de cafeterías sigue devolviendo `billing` para no romper
  clientes anteriores.
- `docs/propuesta-fase4-cobro.md` queda como registro histórico.

## 5. Impacto en otras cifras

`orders.total` incluye el cargo. Las **ventas de productos** son `total - service_fee_cop`, y
así las calcula el dashboard del admin (`sql/admin-dashboard/events.sql`). El cargo pertenece
a UniFood, no a la cafetería.

## 6. Entrega

- Flag `SERVICE_FEE_ENABLED` (Render y Vercel), leída solo en servidor, apagada por defecto.
  Apagada: cargo 0, la carta no trae `serviceFee`, los endpoints nuevos responden 404
  `SERVICE_FEE_DISABLED` y el billing anterior sigue igual.
- Orden de despliegue: aplicar la 033 en staging, desplegar el backend, encender el flag.
- Seed de staging: `scripts/supabase/seed-cargo-servicio-staging.sql`.

## 7. Pendientes explícitos (fuera de este alcance)

- **IVA y facturación del cargo:** si el cargo lleva IVA, quién factura (UniFood al
  estudiante o a la cafetería) y cómo se refleja en el ticket.
- **Comisión de la pasarela** cuando haya pagos en línea: quién la absorbe (estudiante,
  cafetería o UniFood) y si cambia el valor del cargo.
- **Aceptación del modelo por la cafetería:** mecanismo y registro (contrato, aceptación en el
  panel, fecha y versión de los términos).
- **Penalización por pedidos no recogidos:** hoy no hay ninguna; definir si aplica y a quién.
