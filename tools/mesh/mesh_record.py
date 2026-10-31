"""
GhostSlot mesh recorder: tell the server how many people are in the room,
record for a while, then download everything as a CSV for training.

Only Python's standard library is used. The admin key is read from the
GS_ADMIN_KEY environment variable (the same value as CSI_ADMIN_KEY on Render),
so it never ends up in your shell history or in this file.

  # Mac / Linux
  export GS_ADMIN_KEY="your-admin-key"
  # Windows PowerShell
  $env:GS_ADMIN_KEY="your-admin-key"

Examples
  python mesh_record.py status
  python mesh_record.py mode hardware
  python mesh_record.py record 0 --seconds 120      # empty room
  python mesh_record.py record 3 --seconds 120      # three people inside
  python mesh_record.py record z-centre --seconds 90 # ONE person, middle of the room
  python mesh_record.py export --out recordings.csv
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

DEFAULT_SERVER = "https://ghostslot.onrender.com"
LABELS = [str(n) for n in range(11)]  # 0..10 people
# Zone mode: exactly ONE person standing/moving in one zone of the room.
# front = side with boards 1 & 2, back = boards 3 & 4, left = boards 1 & 3,
# right = boards 2 & 4, centre = middle, where the diagonals cross.
ZONE_LABELS = ["z-front", "z-back", "z-left", "z-right", "z-centre"]


def check_server(server):
    # Only real web addresses: the admin key must never go to a file:// or other scheme.
    ok = server.startswith("https://") or server.startswith(("http://localhost", "http://127.0.0.1"))
    if not ok:
        sys.exit("--server must start with https:// (or http://localhost for a local server)")


def call(server, path, method="GET", body=None, admin=True, raw=False):
    check_server(server)
    headers = {"Content-Type": "application/json"}
    if admin:
        key = os.environ.get("GS_ADMIN_KEY", "")
        if not key:
            sys.exit("Set GS_ADMIN_KEY first (same value as CSI_ADMIN_KEY on the server).")
        headers["X-Admin-Key"] = key
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(server.rstrip("/") + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:  # nosec B310 - scheme checked in check_server
            payload = res.read()
    except urllib.error.HTTPError as err:
        detail = err.read().decode(errors="ignore")[:200]
        hints = {401: "admin key is wrong", 403: "CSI_ADMIN_KEY is not set on the server", 409: "server is in simulation mode"}
        sys.exit(f"Server said {err.code}: {detail} ({hints.get(err.code, 'see message')})")
    except urllib.error.URLError as err:
        sys.exit(f"Could not reach {server}: {err.reason}. Render may be waking up, try again in a minute.")
    return payload if raw else json.loads(payload)


def show(st):
    nodes = "  ".join(f"{n}:{'on' if v['online'] else 'OFF'}" for n, v in st["nodes"].items())
    rec = st["recording"]
    counts = "  ".join(f"{k}:{v}" for k, v in rec["rowsByLabel"].items() if v) or "none yet"
    pred = st.get("prediction")
    pred_txt = "none"
    if pred:
        conf = f" ({pred['confidence'] * 100:.0f}% sure)" if pred.get("confidence") is not None else ""
        pred_txt = f"{pred['label']} people{conf} [{pred['source']}]"
        if pred.get("zone"):
            pred_txt += f", zone: {pred['zone']['label']}"
    model = st["model"]
    model_txt = (f"loaded, test accuracy {model['testAccuracy'] * 100:.0f}%"
                 if model.get("loaded") and model.get("testAccuracy") is not None
                 else ("loaded" if model.get("loaded") else f"not loaded ({model.get('reason')})"))
    print(f"mode      : {st['mode']}")
    print(f"nodes     : {nodes}")
    print(f"pairs     : {st['pairsHeard']} of 6 heard")
    print(f"recording : {'ON, label ' + rec['label'] if rec['active'] else 'off'}")
    print(f"rows      : {counts}   (total {rec['totalRows']}, {rec['sessions']} sessions)")
    print(f"model     : {model_txt}")
    zm = st.get("zoneModel") or {}
    print(f"zone model: {'loaded' if zm.get('loaded') else 'not loaded (' + str(zm.get('reason')) + ')'}")
    print(f"prediction: {pred_txt}")


def main():
    ap = argparse.ArgumentParser(description="Record labelled CSI mesh data on the GhostSlot server")
    ap.add_argument("--server", default=os.environ.get("GS_SERVER", DEFAULT_SERVER))
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    m = sub.add_parser("mode"); m.add_argument("mode", choices=["hardware", "simulation"])
    r = sub.add_parser("record")
    r.add_argument("label", choices=LABELS + ZONE_LABELS,
                   help="how many people are inside (0..5+), or z-<zone> for ONE person in that zone")
    r.add_argument("--seconds", type=int, default=120)
    r.add_argument("--settle", type=int, default=10, help="countdown so people can get in place")
    sub.add_parser("stop")
    e = sub.add_parser("export"); e.add_argument("--out", default="mesh-recordings.csv")
    sub.add_parser("clear")
    d = sub.add_parser("door-reset", help="set the IR door counter (default 0 people inside)"); d.add_argument("--inside", type=int, default=0)
    sub.add_parser("door")
    args = ap.parse_args()

    if args.cmd == "status":
        show(call(args.server, "/api/csi/mesh/status", admin=False))
    elif args.cmd == "mode":
        show(call(args.server, "/api/csi/mesh/mode", "POST", {"mode": args.mode})["status"])
    elif args.cmd == "stop":
        call(args.server, "/api/csi/mesh/record", "POST", {"label": None})
        print("Recording stopped.")
    elif args.cmd == "door-reset":
        st = call(args.server, "/api/door/reset", "POST", {"inside": args.inside})["status"]
        print(f"Door counter set: {st['inside']} inside")
    elif args.cmd == "door":
        st = call(args.server, "/api/door/status", admin=False)
        beams = st["beams"]
        print(f"door board : {'ONLINE' if st['online'] else 'OFFLINE'}")
        print(f"beams      : A {'CUT' if beams['a'] else 'clear'} · B {'CUT' if beams['b'] else 'clear'}")
        print(f"count      : {st['inside']} inside ({st['entries']} in, {st['exits']} out)")
    elif args.cmd == "clear":
        if input("Delete ALL recordings on the server? Type yes: ").strip().lower() == "yes":
            call(args.server, "/api/csi/mesh/clear", "POST", {})
            print("Cleared.")
    elif args.cmd == "export":
        csv = call(args.server, "/api/csi/mesh/export", raw=True)
        with open(args.out, "wb") as fh:
            fh.write(csv)
        rows = max(csv.count(b"\n") - 1, 0)
        print(f"Saved {rows} rows to {args.out}")
    elif args.cmd == "record":
        st = call(args.server, "/api/csi/mesh/status", admin=False)
        if st["mode"] != "hardware":
            print("Warning: server is in SIMULATION mode, these rows will be fake. "
                  "Run 'python mesh_record.py mode hardware' first.")
        if st["pairsHeard"] < 2:
            print(f"Warning: only {st['pairsHeard']} board pairs heard. Check the boards are on.")
        for i in range(args.settle, 0, -1):
            who = (f"ONE person into the {args.label[2:]} zone" if args.label.startswith("z-")
                   else f"{args.label} people in place")
            print(f"\rGet {who}, starting in {i:2d}s ", end="", flush=True)
            time.sleep(1)
        print()
        call(args.server, "/api/csi/mesh/record", "POST", {"label": args.label})
        start = time.time()
        try:
            while time.time() - start < args.seconds:
                left = args.seconds - (time.time() - start)
                print(f"\rRecording '{args.label}' ... {left:4.0f}s left (move normally, sit, stand) ",
                      end="", flush=True)
                time.sleep(1)
        except KeyboardInterrupt:
            print("\nStopped early.")
        finally:
            st = call(args.server, "/api/csi/mesh/record", "POST", {"label": None})["status"]
        print(f"\nDone. Rows for '{args.label}': {st['recording']['rowsByLabel'][args.label]}")
        print("Tip: export after every few recordings. Render's free disk is wiped on redeploy.")


if __name__ == "__main__":
    main()
