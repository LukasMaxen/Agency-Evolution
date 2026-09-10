#!/usr/bin/env python3
"""
Extract a deduped LinkedIn URL column from a filtered lead-list CSV,
ready for GetLeads CSV enrichment (mode="linkedin").

Usage:
    python3 extract_linkedin_urls.py <input.csv> <output.csv> [column_name]

column_name defaults to "Company Linkedin Url" (Apollo export header).
Output has two columns: "LinkedIn Url" and "Company Name" (kept for
readability). GetLeads' upload parser fails outright on a genuinely
single-column CSV ("Unable to auto-detect delimiting character") since
there's no comma on any line to detect a delimiter from — always emit
at least two columns, never just one.

Matches the standing mapping used with create_csv_enrichment_upload_link:
    mapping={"profileUrl": "LinkedIn Url"}
"""
import csv
import sys

DEFAULT_COLUMN = "Company Linkedin Url"
NAME_COLUMN = "Company Name"


def main():
    if len(sys.argv) not in (3, 4):
        print("Usage: python3 extract_linkedin_urls.py <input.csv> <output.csv> [column_name]")
        sys.exit(1)

    in_path, out_path = sys.argv[1], sys.argv[2]
    column = sys.argv[3] if len(sys.argv) == 4 else DEFAULT_COLUMN

    rows = []
    with open(in_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if column not in reader.fieldnames:
            print(f"Column '{column}' not found. Available columns: {reader.fieldnames}")
            sys.exit(1)
        for row in reader:
            url = (row.get(column) or "").strip()
            if url:
                rows.append((url, (row.get(NAME_COLUMN) or "").strip()))

    seen = set()
    uniq = []
    for url, name in rows:
        if url not in seen:
            seen.add(url)
            uniq.append((url, name))

    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["LinkedIn Url", "Company Name"])
        for url, name in uniq:
            writer.writerow([url, name])

    print(f"Rows with a LinkedIn URL: {len(rows)}")
    print(f"Unique LinkedIn URLs written: {len(uniq)}")


if __name__ == "__main__":
    main()
