"""
Calibrate GhostSlot occupancy LEVELS for one room: Empty (0), 1 person, 2+.

Why this exists: with a small amount of training data the full count model
(train_count_model.py) can't reliably tell 2 from 3 from 4 people. The overall
motion between the boards, averaged over ~20 seconds, does separate an empty
room, one person and a group well. This script learns the two cut-off values
from your labelled recordings. Standard library only.

  python calibrate_levels.py venue.csv
  -> server/models/mesh-levels.json   (commit it; the server uses it when no
                                      count model is present)

Honest test: thresholds are learned on one recording session per label and
tested on a different session of the same label (and the other way round).
Record each label at least twice.
"""
import argparse
import csv
import json
import os
import sys
import time

CLASSES = ["0", "1", "2+"]


def level_of(label):
    n = 5 if label == "5+" else int(label)
    return min(n, 2)


def load(paths):
    sessions = {}  # session -> (level, [motion_mean...]) in time order
    for p in paths:
        with open(p, newline="") as f:
            for r in csv.DictReader(f):
                lab = r.get("label", "")
                if lab.startswith("z-") or lab == "":
                    continue
                try:
                    v = float(r["motion_mean"])
                except (KeyError, ValueError):
                    continue
                if v < 0:
                    continue  # -1 = pair not heard
                lvl, vals = sessions.setdefault(r["session"], (level_of(lab), []))
                vals.append(v)
    return sessions


def rolling(vals, w):
    out = []
    for i in range(len(vals)):
        chunk = vals[max(0, i - w + 1): i + 1]
        out.append(sum(chunk) / len(chunk))
    return out


def predict(v, a, b):
    return 0 if v < a else 1 if v < b else 2


def fit(points):
    """points: [(value, level)]. Best balanced accuracy over a grid of cut-offs."""
    lo = min(v for v, _ in points)
    hi = max(v for v, _ in points)
    step = max((hi - lo) / 300, 0.1)
    grid = [lo + i * step for i in range(301)]
    best = (-1, 0, 0)
    for i, a in enumerate(grid):
        for b in grid[i + 1:]:
            per = []
            for c in range(3):
                pts = [v for v, l in points if l == c]
                if pts:
                    per.append(sum(predict(v, a, b) == c for v in pts) / len(pts))
            bal = sum(per) / len(per)
            if bal > best[0]:
                best = (bal, a, b)
    return best


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", nargs="+")
    ap.add_argument("--window", type=int, default=10, help="windows to average (2 s each); default 10 = 20 s")
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("--out", default=os.path.join(here, "..", "..", "server", "models", "mesh-levels.json"))
    args = ap.parse_args()

    sessions = load(args.csv)
    by_level = {c: [s for s, (l, _) in sessions.items() if l == c] for c in range(3)}
    for c in range(3):
        if not by_level[c]:
            sys.exit(f"No recordings for level {CLASSES[c]}. Record it first.")
    pts = {s: [(v, l) for v in rolling(vals, args.window)] for s, (l, vals) in sessions.items()}

    # Honest test: split sessions of each level into A (first) and B (last), train on one, test on the other.
    accs = []
    if all(len(by_level[c]) >= 2 for c in range(3)):
        A = [by_level[c][0] for c in range(3)]
        B = [by_level[c][-1] for c in range(3)]
        for train, test in ((A, B), (B, A)):
            _, a, b = fit([p for s in train for p in pts[s]])
            test_pts = [p for s in test for p in pts[s]]
            accs.append(sum(predict(v, a, b) == l for v, l in test_pts) / len(test_pts))
        test_acc = sum(accs) / len(accs)
    else:
        test_acc = None

    all_pts = [p for s in pts for p in pts[s]]
    bal, a, b = fit(all_pts)
    rows = sum(len(v) for _, v in sessions.values())
    model = {
        "kind": "levels",
        "feature": "motion_mean",
        "window": args.window,
        "classes": CLASSES,
        "thresholds": [round(a, 2), round(b, 2)],
        "meta": {
            "trainedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "trainRows": rows,
            "sessions": len(sessions),
            "testAccuracy": round(test_acc, 3) if test_acc is not None else None,
            "note": "Levels from overall CSI motion averaged over the window; calibrated for one room.",
        },
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(model, f, indent=1)

    print(f"{rows} rows in {len(sessions)} sessions; window {args.window} x 2 s")
    print(f"cut-offs: empty < {a:.1f} <= 1 person < {b:.1f} <= 2+")
    if test_acc is None:
        print("held-out test: skipped (record every level at least twice)")
    else:
        print(f"held-out test (other session of each level): {test_acc*100:.1f}%  "
              f"[{', '.join(f'{x*100:.0f}%' for x in accs)}]")
    print(f"Saved {os.path.abspath(args.out)}")


if __name__ == "__main__":
    main()
