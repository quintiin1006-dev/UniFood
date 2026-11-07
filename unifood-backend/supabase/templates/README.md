# Plantillas de correo de Supabase Auth

Se copian tal cual en el panel de cada proyecto, primero en `unifood-staging` y después en
el real. No se editan aquí: el diseño se cambia en los archivos de origen y se vuelven a
copiar.

| Archivo               | Pantalla de Supabase                         | Asunto                                     |
| --------------------- | -------------------------------------------- | ------------------------------------------ |
| `confirmation.html`   | Authentication > Emails > **Confirm signup** | `Tu código de verificación de UniFood`     |
| `reset-password.html` | Authentication > Emails > **Reset password** | `Tu código para restablecer tu contraseña` |

- Ambas muestran el código con `{{ .Token }}` y no contienen enlaces ni
  `{{ .ConfirmationURL }}`. El registro y la recuperación usan códigos de 6 dígitos.
- Se reemplaza **todo** el cuerpo de la plantilla en el panel, no solo una parte.

## Encabezado

La imagen del encabezado se sirve desde el bucket **público** `branding` del proyecto
real (`qcdxkmowlbptgbgjuywc`), que ya contiene `unifood-email-header.png`. La URL está fija
en las dos plantillas.

- Las plantillas se copian tal cual a cualquier proyecto, staging o real, sin cambiar la
  URL.
- Todo lo que se sube a `branding` es público: solo debe contener imágenes de marca.
- Si algún día se cambia de proyecto o de dominio, hay que subir la imagen al nuevo bucket
  y actualizar la URL en las dos plantillas.

## Vigencia del código

Las dos plantillas dicen «El código vence en 15 minutos». Eso debe coincidir con la
vigencia del OTP en Auth, **900 s** (Email OTP expiration). Si una cambia, cambia la
otra.

## Proyecto real

La plantilla **Reset password** del real sigue siendo la de Supabase por defecto, con
enlace. Hay que reemplazarla por `reset-password.html` antes de usar la recuperación de
contraseña. Seguimiento en #41.
