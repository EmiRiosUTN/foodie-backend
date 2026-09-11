# Búsqueda de reservas por nombre para n8n

Usá este endpoint cuando el cliente quiera modificar o cancelar una reserva y no tenga su código.

## Buscar

`GET /v1/external/reservations/search`

Headers:

```text
x-api-key: {{$env.FOODIE_INTEGRATION_KEY}}
```

Query params:

```text
fullName={{ $json.fullName }}
serviceDate={{ $json.serviceDate }}   # opcional, YYYY-MM-DD
phone={{ $json.phone }}               # opcional
restaurantId={{ $json.restaurantId }} # solo con API key global
```

La respuesta tiene `total` y `results`. El nombre debe coincidir de forma exacta, sin diferenciar mayúsculas de minúsculas. Los resultados incluyen el código que se utilizará en las acciones posteriores.

```json
{
  "total": 1,
  "results": [
    {
      "code": "A7K9M2",
      "fullName": "Juan Pérez",
      "phone": "••••1234",
      "partySize": 4,
      "serviceDate": "2026-10-18",
      "serviceTime": "21:00",
      "status": "confirmed",
      "branch": "Puerto Madero",
      "room": "Salón Principal"
    }
  ]
}
```

## Flujo recomendado

1. HTTP Request: buscar con `fullName`.
2. Switch por `total`:
   - `0`: informar que no se encontró una reserva.
   - `1`: conservar `results[0].code`.
   - mayor que `1`: pedir fecha o teléfono y repetir la búsqueda.
3. Antes de cancelar, pedir confirmación al cliente.
4. Para modificar, llamar `POST /v1/external/reservations/update`; para cancelar, `POST /v1/external/reservations/cancel`. En ambos casos enviar `code` con el valor de la búsqueda y un header `idempotency-key` único por operación.

No selecciones automáticamente una reserva cuando `total` sea mayor que uno.
