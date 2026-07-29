import difflib

import pandas as pd


def _title_score(title, target_titles):
    if not title or not target_titles:
        return 50.0
    title_l = title.lower()
    best = 0.0
    for t in target_titles:
        t_l = t.lower()
        if t_l in title_l or title_l in t_l:
            best = max(best, 95.0)
            continue
        ratio = difflib.SequenceMatcher(None, title_l, t_l).ratio() * 100
        best = max(best, ratio)
    return best


def _keyword_score(text, keywords):
    if not text or not keywords:
        return 50.0
    text_l = text.lower()
    hits = sum(1 for k in keywords if k.lower() in text_l)
    return min(100.0, hits * 40.0)


def score_people(records: list, relevance_cfg: dict) -> pd.DataFrame:
    """Hard-filters (exclusions) + soft scoring. Returns a DataFrame with a
    relevance_score column; rows that fail an exclusion are dropped outright
    (score -1, filtered out before returning)."""
    df = pd.DataFrame(records)
    if df.empty:
        return df

    target_titles = relevance_cfg.get("target_titles", [])
    target_keywords = relevance_cfg.get("target_keywords", [])
    exclude_titles = [t.lower() for t in relevance_cfg.get("exclude_titles", [])]
    exclude_keywords = [k.lower() for k in relevance_cfg.get("exclude_keywords", [])]

    def row_score(row):
        title = row.get("title") or ""
        industry = row.get("industry") or ""
        company_name = (row.get("company") or "").lower()
        blob = f"{title} {industry} {company_name}".lower()

        if any(et in title.lower() for et in exclude_titles):
            return -1.0
        if any(ek in blob for ek in exclude_keywords):
            return -1.0

        # Apollo's free search only returns real industry/description text after
        # enrichment (pre-enrichment it's just an unrevealed has_industry flag),
        # so keyword match is near-always a miss for reasons unrelated to fit.
        # Title is the one rich field we actually get back, so it drives the
        # score; a keyword hit (when we do have text, e.g. it's in the company
        # name) is a bonus, never a penalty for the field being unavailable.
        t_score = _title_score(title, target_titles) if target_titles else 50.0
        k_score = _keyword_score(f"{industry} {company_name}", target_keywords) if target_keywords else 0.0
        score = t_score + (k_score * 0.15 if k_score > 0 else 0.0)
        return round(min(100.0, score), 1)

    df["relevance_score"] = df.apply(row_score, axis=1)
    df = df[df["relevance_score"] >= 0].reset_index(drop=True)
    return df
