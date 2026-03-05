"""
Calculate CRR (Character Recognition Rate), WRR (Word Recognition Rate),
and Out-of-Order Precision & Recall between ground truth and OCR output.

CRR = 1 - (char_edit_distance / total_gt_chars)
WRR = 1 - (word_edit_distance / total_gt_words)
OOO Precision = |GT ∩ Pred| / |Pred|   (multiset intersection)
OOO Recall    = |GT ∩ Pred| / |GT|     (multiset intersection)
"""
from collections import Counter


def edit_distance(s1, s2):
    """Compute Levenshtein edit distance between two sequences."""
    m, n = len(s1), len(s2)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1):
        dp[i][0] = i
    for j in range(n + 1):
        dp[0][j] = j
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if s1[i - 1] == s2[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    return dp[m][n]


def multiset_intersection_size(a, b):
    """Size of the multiset intersection: sum of min counts for each element."""
    counter_a = Counter(a)
    counter_b = Counter(b)
    return sum((counter_a & counter_b).values())


def main():
    gt_path = r"c:\Users\mfaiz\Desktop\Sem-10\mtp\UrduDocCoco\gt.txt"
    pred_path = r"c:\Users\mfaiz\Desktop\Sem-10\mtp\UrduDocCoco\qwen2.5_out.txt"

    with open(gt_path, "r", encoding="utf-8") as f:
        gt_text = f.read().strip()
    with open(pred_path, "r", encoding="utf-8") as f:
        pred_text = f.read().strip()

    # --- Character Recognition Rate (CRR) ---
    gt_chars = gt_text.replace(" ", "").replace("\n", "").replace("\r", "")
    pred_chars = pred_text.replace(" ", "").replace("\n", "").replace("\r", "")

    char_ed = edit_distance(gt_chars, pred_chars)
    total_gt_chars = len(gt_chars)
    crr = max(0, 1 - char_ed / total_gt_chars) * 100

    print("=" * 60)
    print("CHARACTER-LEVEL ANALYSIS")
    print("=" * 60)
    print(f"  Ground truth characters : {total_gt_chars}")
    print(f"  Predicted characters    : {len(pred_chars)}")
    print(f"  Character edit distance : {char_ed}")
    print(f"  CRR (Character Recog.)  : {crr:.2f}%")

    # --- Word Recognition Rate (WRR) ---
    gt_words = gt_text.split()
    pred_words = pred_text.split()

    word_ed = edit_distance(gt_words, pred_words)
    total_gt_words = len(gt_words)
    wrr = max(0, 1 - word_ed / total_gt_words) * 100

    print()
    print("=" * 60)
    print("WORD-LEVEL ANALYSIS")
    print("=" * 60)
    print(f"  Ground truth words      : {total_gt_words}")
    print(f"  Predicted words         : {len(pred_words)}")
    print(f"  Word edit distance      : {word_ed}")
    print(f"  WRR (Word Recognition)  : {wrr:.2f}%")

    # --- Out-of-Order Precision & Recall (Word-level) ---
    word_intersection = multiset_intersection_size(gt_words, pred_words)
    ooo_word_precision = (word_intersection / len(pred_words) * 100) if pred_words else 0
    ooo_word_recall    = (word_intersection / len(gt_words) * 100) if gt_words else 0
    ooo_word_f1 = (2 * ooo_word_precision * ooo_word_recall / (ooo_word_precision + ooo_word_recall)) if (ooo_word_precision + ooo_word_recall) > 0 else 0

    print()
    print("=" * 60)
    print("OUT-OF-ORDER WORD-LEVEL PRECISION & RECALL")
    print("=" * 60)
    print(f"  Matched words (bag)     : {word_intersection}")
    print(f"  Precision               : {ooo_word_precision:.2f}%")
    print(f"  Recall                  : {ooo_word_recall:.2f}%")
    print(f"  F1                      : {ooo_word_f1:.2f}%")

    # --- Out-of-Order Precision & Recall (Character-level) ---
    char_intersection = multiset_intersection_size(gt_chars, pred_chars)
    ooo_char_precision = (char_intersection / len(pred_chars) * 100) if pred_chars else 0
    ooo_char_recall    = (char_intersection / len(gt_chars) * 100) if gt_chars else 0
    ooo_char_f1 = (2 * ooo_char_precision * ooo_char_recall / (ooo_char_precision + ooo_char_recall)) if (ooo_char_precision + ooo_char_recall) > 0 else 0

    print()
    print("=" * 60)
    print("OUT-OF-ORDER CHARACTER-LEVEL PRECISION & RECALL")
    print("=" * 60)
    print(f"  Matched characters (bag): {char_intersection}")
    print(f"  Precision               : {ooo_char_precision:.2f}%")
    print(f"  Recall                  : {ooo_char_recall:.2f}%")
    print(f"  F1                      : {ooo_char_f1:.2f}%")

    # --- Summary ---
    print()
    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  CRR                     : {crr:.2f}%")
    print(f"  WRR                     : {wrr:.2f}%")
    print(f"  OOO Word  Precision     : {ooo_word_precision:.2f}%")
    print(f"  OOO Word  Recall        : {ooo_word_recall:.2f}%")
    print(f"  OOO Word  F1            : {ooo_word_f1:.2f}%")
    print(f"  OOO Char  Precision     : {ooo_char_precision:.2f}%")
    print(f"  OOO Char  Recall        : {ooo_char_recall:.2f}%")
    print(f"  OOO Char  F1            : {ooo_char_f1:.2f}%")
    print("=" * 60)



if __name__ == "__main__":
    main()
