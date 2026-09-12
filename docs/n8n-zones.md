# Zonas de salon en n8n

Foodie entrega las zonas configuradas en `GET /v1/external/assistant/context` dentro de cada salon:

```json
{
  "id": "room_123",
  "name": "Salon principal",
  "zones": [
    { "id": "zone_123", "name": "Vista al rio" }
  ]
}
```

## Contexto y cache

Conserva `branches[].rooms[].zones` al armar el contexto que recibe el agente. Refresca el contexto cuando cambie `configVersion` y usa el `systemMessage` devuelto por Foodie como prompt del sistema.

## Preferencia de zona

1. Solo cuando el cliente pida una ubicacion, busca la zona por nombre dentro del salon seleccionado y guarda su `id` como `preferredZone`.
2. Envia `preferredZone` a `POST /v1/external/reservations/quote` y, si el cliente confirma, a `POST /v1/external/reservations`.
3. Si la cotizacion responde `status: "general_only"`, informa que no puede garantizarse esa zona y pide aceptacion expresa antes de repetir la operacion sin `preferredZone`.
4. Si no se pidio una zona, omite `preferredZone` de ambos cuerpos. Nunca expongas IDs internos al cliente.
