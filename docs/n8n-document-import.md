# Importación automática de documentos desde n8n

Cada adjunto entrante se importa en tres pasos con el `x-api-key` del restaurante.

1. `POST /v1/external/documents/upload-url` con `fileName`, `mimeType`, `size`, `contactName`, `contactPhone`, `externalMessageId`, `caption` y, si la IA la calcula, `suggestedCategory` y `suggestionConfidence`.
2. Subir el binario con `PUT` a `uploadUrl`, usando el mismo `Content-Type`.
3. `POST /v1/external/documents/:documentId/confirm`.

`externalMessageId` debe ser estable: Foodie lo usa para que un reintento no cree otro documento. Si el teléfono coincide con una solicitud de comprobante de seña vigente, el archivo se clasifica como `deposit_proof`, se vincula con esa solicitud y queda pendiente de revisión. El resto ingresa a la bandeja `inbox` y conserva la sugerencia de IA para que un usuario la confirme.

La IA solo sugiere categorías: nunca debe llamar a los endpoints internos de aprobación de comprobantes ni registrar importes.
