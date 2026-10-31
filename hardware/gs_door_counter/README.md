# GhostSlot IR door counter

Two IR sensors on the door frame tell **in** from **out** by the order they are cut.

```
 CORRIDOR |  A  |  B  | ROOM
          | ))) | ))) |
            ↑ 15–20 cm ↑     both at ~1 m (waist) height
```

| Sequence | Meaning |
|---|---|
| A → A+B → B → clear | **IN** (+1) |
| B → A+B → A → clear | **OUT** (−1) |
| anything else | ignored (half step in and back, hand waved) |
| blocked > 4 s | reset (someone standing in the door) |

## Parts (any one option)

| Option | Parts | Set in the sketch |
|---|---|---|
| **IR break-beam pairs** (best for a real door, up to ~25–50 cm per pair; use 2 pairs) | emitter on one post, receiver on the other | `CUT_LEVEL HIGH` |
| **E18-D80NK** (up to ~80 cm, 5 V) | 2 sensors on one post, facing across | `CUT_LEVEL LOW` |
| **FC-51 / TCRT5000 obstacle modules** (cheapest, short range 2–30 cm: fine for a table-top demo) | 2 modules side by side | `CUT_LEVEL LOW` |

Plus any spare ESP32 (classic, S3 or C3).

## Wiring

| Sensor | ESP32 |
|---|---|
| Sensor A signal (outside) | GPIO 4 |
| Sensor B signal (inside) | GPIO 5 |
| VCC | 3V3 (E18-D80NK: 5V/VIN; its output is open-collector so it is safe with the internal pull-up) |
| GND | GND |

Break-beam emitters only need VCC and GND.

## Flash

1. Copy `secrets.example.h` to `secrets.h` and use the **same** Wi-Fi and `DEVICE_KEY` as the mesh boards.
2. Pick your board in Arduino IDE (S3/C3: *USB CDC On Boot: Enabled*), upload.
3. Serial Monitor at 115200. Walk from the corridor side: `[door] A -> A+B -> B => IN`.
4. The Demo Room card in the app shows **Door counter (IR)** live, next to QR check-ins and the Wi-Fi count.

Reset the count (e.g. at the start of a demo), with the admin key:

```bash
curl -X POST https://ghostslot.onrender.com/api/door/reset \
  -H "Content-Type: application/json" -H "X-Admin-Key: $GS_ADMIN_KEY" -d '{"inside":0}'
```
