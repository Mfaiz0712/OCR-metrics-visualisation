"""
generate_data.py  —  Live OCR Evaluation Server
-------------------------------------------------
Serves the dashboard AND recomputes data.json on every browser refresh
by reading gt.txt and all model output files live.

Usage:
    python generate_data.py          # starts server on port 8765
    python generate_data.py 9000     # custom port

To add a new model, just add an entry to the MODELS dict below.
"""
from collections import Counter
from http.server import HTTPServer, SimpleHTTPRequestHandler
import difflib
import json
import os
import sys

# ─── Configuration ────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GT_FILE  = os.path.join(BASE_DIR, "gt.txt")
PORT     = int(sys.argv[1]) if len(sys.argv) > 1 else 8765

MODELS = {
    "Qwen2.5-VL": "qwen2.5_out.txt",
    "PARSeq":     "parseq.txt",
    # Add more models here:
    # "MyModel": "mymodel_out.txt",
}
# ──────────────────────────────────────────────────────────────────────────────


# ═══════════════════════════════════════════════════════════════════════════════
#  Metric computation (unchanged logic)
# ═══════════════════════════════════════════════════════════════════════════════

def edit_distance(s1, s2):
    m, n = len(s1), len(s2)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1): dp[i][0] = i
    for j in range(n + 1): dp[0][j] = j
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if s1[i-1] == s2[j-1]:
                dp[i][j] = dp[i-1][j-1]
            else:
                dp[i][j] = 1 + min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
    return dp[m][n]


def multiset_intersection(a, b):
    ca, cb = Counter(a), Counter(b)
    return sum((ca & cb).values())


def compute_metrics(gt_text, pred_text):
    gt_chars   = gt_text.replace(" ", "").replace("\n", "").replace("\r", "")
    pred_chars = pred_text.replace(" ", "").replace("\n", "").replace("\r", "")
    gt_words   = gt_text.split()
    pred_words = pred_text.split()

    char_ed = edit_distance(gt_chars, pred_chars)
    crr = max(0.0, 1 - char_ed / len(gt_chars)) * 100 if gt_chars else 0.0

    word_ed = edit_distance(gt_words, pred_words)
    wrr = max(0.0, 1 - word_ed / len(gt_words)) * 100 if gt_words else 0.0

    wi = multiset_intersection(gt_words, pred_words)
    ooo_wp = wi / len(pred_words) * 100 if pred_words else 0.0
    ooo_wr = wi / len(gt_words)   * 100 if gt_words  else 0.0
    ooo_wf = (2 * ooo_wp * ooo_wr / (ooo_wp + ooo_wr)) if (ooo_wp + ooo_wr) else 0.0

    return {
        "crr": round(crr, 2),
        "wrr": round(wrr, 2),
        "ooo_word_precision": round(ooo_wp, 2),
        "ooo_word_recall":    round(ooo_wr, 2),
        "ooo_word_f1":        round(ooo_wf, 2),
    }


def build_word_diff(gt_words, pred_words):
    matcher = difflib.SequenceMatcher(None, gt_words, pred_words, autojunk=False)
    tokens = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        gt_span   = " ".join(gt_words[i1:i2])
        pred_span = " ".join(pred_words[j1:j2])
        if tag == "equal":
            for w in pred_words[j1:j2]:
                tokens.append({"text": w, "type": "correct", "gt": w})
        elif tag == "replace":
            tokens.append({"text": pred_span, "type": "wrong",   "gt": gt_span})
        elif tag == "delete":
            tokens.append({"text": gt_span,   "type": "missing", "gt": gt_span})
        elif tag == "insert":
            tokens.append({"text": pred_span, "type": "extra",   "gt": ""})
    return tokens


def generate_data():
    """Read all files fresh from disk and return the JSON payload."""
    with open(GT_FILE, "r", encoding="utf-8") as f:
        gt_text = f.read().strip()
    gt_words = gt_text.split()

    output = {"gt_text": gt_text, "models": {}}

    for model_name, filename in MODELS.items():
        path = os.path.join(BASE_DIR, filename)
        if not os.path.exists(path):
            continue
        with open(path, "r", encoding="utf-8") as f:
            pred_text = f.read().strip()

        metrics = compute_metrics(gt_text, pred_text)
        diff    = build_word_diff(gt_words, pred_text.split())

        output["models"][model_name] = {"metrics": metrics, "diff": diff}
        print(f"  {model_name}: CRR={metrics['crr']}%  WRR={metrics['wrr']}%")

    return json.dumps(output, ensure_ascii=False, indent=2)


# ═══════════════════════════════════════════════════════════════════════════════
#  HTTP Server — intercepts /data.json, serves everything else normally
# ═══════════════════════════════════════════════════════════════════════════════

class LiveHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def do_GET(self):
        if self.path == "/data.json" or self.path.startswith("/data.json?"):
            print(f"\n[LIVE] Recomputing data.json ...")
            payload = generate_data()
            data = payload.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
        else:
            super().do_GET()


def main():
    server = HTTPServer(("", PORT), LiveHandler)
    print(f"╔══════════════════════════════════════════════════╗")
    print(f"║  OCR Eval Dashboard — Live Server                ║")
    print(f"║  http://localhost:{PORT}                          ║")
    print(f"║                                                  ║")
    print(f"║  data.json is recomputed on every refresh!       ║")
    print(f"║  Edit any .txt file and just refresh the browser ║")
    print(f"╚══════════════════════════════════════════════════╝")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        server.server_close()


if __name__ == "__main__":
    main()
