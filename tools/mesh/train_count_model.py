"""
Train the GhostSlot mesh models from recorded CSI data.

  pip install scikit-learn numpy

  # people count (0, 1, 2, 3, 4, 5+)  -> server/models/mesh-count.json
  python train_count_model.py round1.csv round2.csv

  # zone of ONE person (front, back, left, right, centre) -> server/models/mesh-zone.json
  python train_count_model.py --task zone round1.csv round2.csv

The same CSV exports work for both: each task only uses its own labels
('0'..'5+' for count, 'z-front'..'z-centre' for zone).

How it tests itself honestly:
  * Rows are grouped into SESSIONS (one session = one 'record' run).
  * For every label that has 2+ sessions, the LAST session is held out and
    never seen during training. Accuracy is measured on those held-out rows.
    Rows from the same session are near-copies of each other, so a random
    split would report a fake, much higher accuracy.
  * Labels with only one session can't be tested this way; the report says
    so. Record each label at least twice, at different times.
  * After testing, the final model is trained on ALL rows and exported,
    carrying the held-out accuracy in its metadata (shown in the app).
"""

import argparse
import csv
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

try:
    import numpy as np
    from sklearn.ensemble import RandomForestClassifier
except ImportError:
    sys.exit("Install the training libraries first:  pip install scikit-learn numpy")

COUNT_ORDER = ["0", "1", "2", "3", "4", "5+"]
ZONE_ORDER = ["front", "back", "left", "right", "centre"]
HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(HERE, "..", "..", "server", "models")
TASKS = {
    # task: (class order, label in the CSV -> class name, default output file)
    "count": (COUNT_ORDER, lambda lab: lab if lab in COUNT_ORDER else None, "mesh-count.json"),
    "zone": (ZONE_ORDER, lambda lab: lab[2:] if lab.startswith("z-") and lab[2:] in ZONE_ORDER else None,
             "mesh-zone.json"),
}
CLASS_ORDER = COUNT_ORDER  # set by main() from --task


def load(paths, min_pairs, to_class):
    feature_names, rows = None, []
    for p in paths:
        with open(p, newline="") as fh:
            reader = csv.reader(fh)
            header = next(reader)
            if header[:4] != ["t", "session", "label", "source"]:
                sys.exit(f"{p}: not a GhostSlot mesh export")
            names = header[4:]
            if feature_names is None:
                feature_names = names
            elif names != feature_names:
                sys.exit(f"{p}: columns differ from the first file (exported by a different server version)")
            for r in reader:
                if len(r) != len(header):
                    continue
                cls = to_class(r[2])
                if cls is None:
                    continue  # a label for the other task
                rows.append({"session": r[1], "label": cls, "source": r[3],
                             "x": [float(v) for v in r[4:]]})
    if not rows:
        sys.exit("No rows for this task found. Did you record its labels?")
    sim = sum(1 for r in rows if r["source"] != "hardware")
    if sim:
        print(f"Skipping {sim} simulated rows (only real hardware data is used).")
    pairs_col = feature_names.index("links_present")
    rows = [r for r in rows if r["source"] == "hardware" and r["x"][pairs_col] >= min_pairs]
    if not rows:
        sys.exit("No usable hardware rows left. Check the boards were in hardware mode while recording.")
    return feature_names, rows


def split_by_session(rows):
    sessions = defaultdict(list)  # label -> ordered unique sessions
    for r in rows:
        if r["session"] not in sessions[r["label"]]:
            sessions[r["label"]].append(r["session"])
    held = {lab: s[-1] for lab, s in sessions.items() if len(s) >= 2}
    train = [r for r in rows if held.get(r["label"]) != r["session"]]
    test = [r for r in rows if held.get(r["label"]) == r["session"]]
    untested = sorted(set(sessions) - set(held), key=CLASS_ORDER.index)
    return train, test, untested, sessions


def make_model():
    return RandomForestClassifier(n_estimators=40, max_depth=10, min_samples_leaf=3,
                                  class_weight="balanced", random_state=42, n_jobs=-1)


def encode(rows):
    # Labels are trained as class numbers and turned back into names on export.
    return np.array([CLASS_ORDER.index(r["label"]) for r in rows])


def within_one(y_true, y_pred):
    idx = {c: i for i, c in enumerate(CLASS_ORDER)}
    return float(np.mean([abs(idx[a] - idx[b]) <= 1 for a, b in zip(y_true, y_pred)]))


def export(model, feature_names, meta, out):
    trees = []
    for est in model.estimators_:
        t = est.tree_
        n = t.node_count
        tree = {"f": [], "t": [], "l": [], "r": [], "v": []}
        for i in range(n):
            leaf = t.children_left[i] == -1
            tree["f"].append(-2 if leaf else int(t.feature[i]))
            tree["t"].append(-2 if leaf else round(float(t.threshold[i]), 6))
            tree["l"].append(int(t.children_left[i]))
            tree["r"].append(int(t.children_right[i]))
            if leaf:
                v = t.value[i][0]
                s = float(v.sum()) or 1.0
                tree["v"].append([round(float(x) / s, 4) for x in v])
            else:
                tree["v"].append(None)
        trees.append(tree)
    doc = {"type": "random_forest", "classes": [CLASS_ORDER[int(c)] for c in model.classes_],
           "featureNames": feature_names, "trees": trees, "meta": meta}
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    return os.path.getsize(out)


def main():
    global CLASS_ORDER
    ap = argparse.ArgumentParser(description="Train the GhostSlot mesh models")
    ap.add_argument("csv", nargs="+", help="CSV files from 'mesh_record.py export'")
    ap.add_argument("--task", choices=sorted(TASKS), default="count",
                    help="count = how many people; zone = where ONE person is")
    ap.add_argument("--out", default=None, help="output file (default: server/models/mesh-<task>.json)")
    ap.add_argument("--min-pairs", type=int, default=2, help="ignore windows with fewer board pairs heard")
    args = ap.parse_args()
    CLASS_ORDER, to_class, default_name = TASKS[args.task]
    out = args.out or os.path.join(MODELS, default_name)

    names, rows = load(args.csv, args.min_pairs, to_class)
    labels = sorted({r["label"] for r in rows}, key=CLASS_ORDER.index)
    print(f"{len(rows)} usable rows, labels: " +
          ", ".join(f"{l}={sum(1 for r in rows if r['label'] == l)}" for l in labels))
    if len(labels) < 2:
        sys.exit("Need at least two different labels to train.")

    train, test, untested, sessions = split_by_session(rows)
    meta = {"task": args.task, "trainedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "trainRows": len(rows), "labels": labels,
            "sessionsPerLabel": {l: len(sessions[l]) for l in labels},
            "testAccuracy": None, "withinOneAccuracy": None, "testRows": len(test),
            "untestedLabels": untested}

    if test and len({r["label"] for r in train}) >= 2:
        m = make_model()
        m.fit(np.array([r["x"] for r in train]), encode(train))
        y_true = [r["label"] for r in test]
        y_pred = [CLASS_ORDER[int(c)] for c in m.predict(np.array([r["x"] for r in test]))]
        acc = float(np.mean([a == b for a, b in zip(y_true, y_pred)]))
        meta["testAccuracy"] = round(acc, 3)
        print(f"\nHeld-out test ({len(test)} windows from sessions never seen in training):")
        if args.task == "count":
            w1 = within_one(y_true, y_pred)
            meta["withinOneAccuracy"] = round(w1, 3)
            print(f"  exact count correct : {acc * 100:.1f}%")
            print(f"  within +/- 1 person : {w1 * 100:.1f}%")
        else:
            print(f"  correct zone        : {acc * 100:.1f}%  (random guessing would be {100 / len(labels):.0f}%)")
        print("\n  confusion (rows = true, columns = predicted)")
        tested = sorted(set(y_true) | set(y_pred), key=CLASS_ORDER.index)
        cm = Counter(zip(y_true, y_pred))
        print("          " + "".join(f"{c:>8}" for c in tested))
        for a in tested:
            print(f"  {a:>7} " + "".join(f"{cm[(a, b)]:>8}" for b in tested))
    else:
        print("\nNo held-out test possible yet: record every label in at least 2 separate sessions.")
    if untested:
        print(f"\nNot tested (only one session): {', '.join(untested)}. Record these again.")

    final = make_model()
    final.fit(np.array([r["x"] for r in rows]), encode(rows))
    size = export(final, names, meta, out)
    print(f"\nSaved {args.task} model ({size / 1024:.0f} KB) to {os.path.normpath(out)}")
    print("Commit it and redeploy (or restart the local server) to use it live.")


if __name__ == "__main__":
    main()
