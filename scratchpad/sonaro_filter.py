#!/usr/bin/env python3
"""
Sonaro AI lead-list ICP filter.

Usage:
    python3 sonaro_filter.py <input.csv> <output.csv>

Keeps only rows whose Company Name matches Sonaro's ICP verticals
(chiropractic, dental/orthodontics, physical therapy/physiotherapy,
dermatology/aesthetics), and drops known non-fits by name
(veterinary, cardiology, radiology/imaging, ophthalmology, hearing aid,
home health/home care, hospice, nursing/skilled-rehab facilities,
associations/councils, billing/admin/transcription companies, DME/mobility,
surgery centers, retirement/assisted-living).

Geography: keeps all rows (US + Europe) per current Sonaro scope (2026-09-09
update: expanded from EU-only to US+EU). Edit KEEP_COUNTRIES to restrict.
"""
import csv
import re
import sys

INCLUDE_PATTERNS = [
    r"chiropract", r"quiroprac",
    r"dental", r"dentist", r"denta\b", r"orthodont", r"tooth", r"teeth", r"smile",
    r"physical therap", r"physiotherap", r"\bphysio\b", r"fysio", r"fisio", r"kinesi", r"podotherap",
    r"dermatolog", r"\bderma", r"\baesthetic", r"\bskin\b",
]

EXCLUDE_PATTERNS = [
    r"veterinary", r"\bvet\b", r"animal",
    r"cardiolog", r"radiolog", r"imaging", r"diagnostic",
    r"ophthalmolog", r"\beye\b", r"vision",
    r"hearing aid",
    r"home health", r"home care", r"homecare", r"hospice",
    r"nursing", r"rehab.*center.*health", r"health.*rehab\b", r"skilled",
    r"assisted living", r"retirement", r"surgery center", r"surgical",
    r"billing", r"transcription", r"communication services", r"revenue advisors",
    r"management\b", r"consultant", r"association", r"assn\b", r"council on",
    r"mobility", r"urology", r"vascular", r"pathology",
    r"hospital\b",
]

INCLUDE_RE = re.compile("|".join(INCLUDE_PATTERNS), re.IGNORECASE)
EXCLUDE_RE = re.compile("|".join(EXCLUDE_PATTERNS), re.IGNORECASE)


def keep_row(name: str) -> bool:
    if not INCLUDE_RE.search(name):
        return False
    if EXCLUDE_RE.search(name):
        return False
    return True


def main():
    if len(sys.argv) != 3:
        print("Usage: python3 sonaro_filter.py <input.csv> <output.csv>")
        sys.exit(1)

    in_path, out_path = sys.argv[1], sys.argv[2]

    kept = []
    dropped_industry_mismatch = []
    dropped_excluded_keyword = []

    with open(in_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        for row in reader:
            name = row.get("Company Name", "") or ""
            if not INCLUDE_RE.search(name):
                dropped_industry_mismatch.append(name)
                continue
            if EXCLUDE_RE.search(name):
                dropped_excluded_keyword.append(name)
                continue
            kept.append(row)

    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(kept)

    total = len(kept) + len(dropped_industry_mismatch) + len(dropped_excluded_keyword)
    print(f"Total rows read:        {total}")
    print(f"Kept (ICP match):       {len(kept)}")
    print(f"Dropped (no vertical match): {len(dropped_industry_mismatch)}")
    print(f"Dropped (excluded keyword):  {len(dropped_excluded_keyword)}")


if __name__ == "__main__":
    main()
