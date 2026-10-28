# People counting with the CSI mesh: setup, recording, training

Four boards in the corners of the Demo Room ping each other. Every board
measures how the Wi-Fi signal from the other three changes, and sends a
short summary to the GhostSlot server every 2 seconds. You record labelled
data ("3 people are inside now"), train a model on your laptop, and the
server then predicts **0, 1, 2, 3, 4 or 5+ people** live on the radar.

```
  [mesh-1: S3] ────────── [mesh-2: ESP32]
       │ ╲               ╱       │
       │    ╲         ╱          │       6 board pairs
       │       ╲   ╱             │       = 12 measured links
       │       ╱   ╲             │
       │    ╱         ╲          │
  [mesh-3: C3] ────────── [mesh-4: S3]

  every board ──hotspot──> GhostSlot server ──> radar in the app
```

No USB data cables to a laptop: the boards only need power (power bank or
phone charger) and the phone hotspot.

---

## Part 1: Server settings (Render, once)

In Render → your service → Environment, add or check:

| Variable | Value |
| --- | --- |
| `CSI_DEVICE_KEY` | a long random string (the boards use it) — already set if the old demo worked |
| `CSI_ADMIN_KEY` | another long random string (only you, for recording) |
| `CSI_MESH_MODE` | `hardware` (leave unset for simulation while you work on the UI) |

Save. Render restarts the server.

## Part 2: Flash the boards (Arduino IDE)

Libraries: **ArduinoJson** (Library Manager). Core: **esp32 by Espressif 3.x**.

1. Open `hardware/gs_mesh_node/gs_mesh_node.ino`.
2. Copy `secrets.example.h` to `secrets.h` in the same folder and fill in the
   hotspot name, password and `DEVICE_KEY` (same as `CSI_DEVICE_KEY`).
   Use a **2.4 GHz** hotspot (iPhone: turn on *Maximise Compatibility*).
3. For each board, change `#define NODE_NUM` and the board type:

| Board | `NODE_NUM` | Arduino board setting | Corner |
| --- | --- | --- | --- |
| ESP32-S3 #1 | 1 | ESP32S3 Dev Module, USB CDC On Boot: Enabled | front-left |
| Normal ESP32 | 2 | ESP32 Dev Module | front-right |
| C3 SuperMini | 3 | ESP32C3 Dev Module, USB CDC On Boot: Enabled | back-left |
| ESP32-S3 #2 | 4 | ESP32S3 Dev Module, USB CDC On Boot: Enabled | back-right |

4. Upload, then open Serial Monitor at **115200**. A healthy board prints:
   ```
   [wifi] connected, IP ..., channel 6
   [csi] listening for the other mesh boards ...
   [mesh] sent 3 link(s) -> server ok
   ```
   `sent 3 link(s)` = it hears all three others. Put a number sticker on it.

If upload hangs at *Connecting...*: hold **BOOT**, tap **RESET**, release BOOT.

## Part 3: Place the boards

- One per corner, about **1 m high** (tape to a bottle, box or wall), antenna end free.
- About 20–30 cm away from walls; nothing big and metal between boards.
- All upright, same direction. **Tape them down: if a board moves, record again.**
- Room size about 3–6 m per side works best.

## Part 4: Record labelled data

On your laptop, in `tools/mesh/`:

```bash
# Mac / Linux
export GS_ADMIN_KEY="your-admin-key"
# Windows PowerShell:  $env:GS_ADMIN_KEY="your-admin-key"

python mesh_record.py status          # check: 4 boards on, 6 pairs heard
python mesh_record.py record 0 --seconds 120
python mesh_record.py record 1 --seconds 120
...
python mesh_record.py export --out session1.csv
```

Each `record` gives a 10 s countdown so people can get in place.

**Recording plan** (2 minutes each, do the whole list **twice**, at different
times — the second round is what the model gets tested on):

| Label | Who's inside |
| --- | --- |
| `0` | nobody (leave the room too!) |
| `1` | 1 person: walk, sit, stand, different spots |
| `2` | 2 people, moving normally |
| `3` | 3 people |
| `4` | 4 people |
| `5+` | 5 or more |

Tips: behave normally (sit, chat, use phones, walk). Mix positions. Doors
closed, same furniture. **Export after every few recordings** — Render's free
disk is wiped when the service redeploys.

## Part 5: Train and switch it on

```bash
pip install scikit-learn numpy
python train_count_model.py session1.csv session2.csv
```

It prints the **held-out accuracy**: tested only on sessions the model never
saw. That number (and only that number) is what you can say on stage.
It saves `server/models/mesh-count.json`. Commit it and push → Render
redeploys → the radar shows live counts.

## Honest limits (say these if a judge asks)

- The model knows **the room it was trained in**. A new room = record again.
- People standing completely still are harder than people moving.
- The dots on the radar show **how many**, not exact positions.
- Accuracy = what the training script measured on held-out sessions, nothing else.

## Troubleshooting

| Serial says | Fix |
| --- | --- |
| `sent 0 link(s)` / `weak link from mesh-N` | that board is off, too far, or on another hotspot |
| `409 ... SIMULATION mode` | set `CSI_MESH_MODE=hardware` on Render |
| `401` | `DEVICE_KEY` in `secrets.h` ≠ `CSI_DEVICE_KEY` on Render |
| `[wifi] FAILED` | hotspot is 5 GHz or the password is wrong |
| only the C3's links are weak | some C3 SuperMinis have weak antennas: move it away from metal or swap in the spare ESP32 |
