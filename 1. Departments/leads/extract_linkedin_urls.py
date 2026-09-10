#!/usr/bin/env python3
"""
Extract a deduped LinkedIn URL column from a filtered lead-list CSV,
ready for GetLeads CSV enrichment (mode="linkedin").

Usage:
    python3 extract_linkedin_urls.py <input.csv> <output.csv> [column_name]

column_name defaults to "Company Linkedin Url" (Apollo export header).
Output has a single column named "LinkedIn Url" — matches the standing
mapping used with create_csv_enrichment_upload_link:
    mapping={"profileUrl": "LinkedIn Url"}
"""
import csv
import sys

DEFAULT_COLUMN = "Company Linkedin Url"


def main():
    if len(sys.argv) not in (3, 4):
        print("Usage: python3 extract_linkedin_urls.py <input.csv> <output.csv> [column_name]")
        sys.exit(1)

    in_path, out_path = sys.argv[1], sys.argv[2]
    column = sys.argv[3] if len(sys.argv) == 4 else DEFAULT_COLUMN

    urls = []
    with open(in_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if column not in reader.fieldnames:
            print(f"Column '{column}' not found. Available columns: {reader.fieldnames}")
            sys.exit(1)
        for row in reader:
            url = (row.get(column) or "").strip()
            if url:
                urls.append(url)

    seen = set()
    uniq = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            uniq.append(u)

    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["LinkedIn Url"])
        for u in uniq:
            writer.writerow([u])

    print(f"Rows with a LinkedIn URL: {len(urls)}")
    print(f"Unique LinkedIn URLs written: {len(uniq)}")


if __name__ == "__main__":
    main()
