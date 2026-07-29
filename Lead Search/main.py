import argparse

from src.pipeline import run_pipeline


def main():
    parser = argparse.ArgumentParser(description="Apollo Search Machine")
    parser.add_argument("--filters", required=True, help="Path to filters JSON file")
    parser.add_argument("--threshold", type=float, default=None, help="Override relevance threshold (default from filters file, or 70)")
    parser.add_argument("--max-results", type=int, default=None, help="Override max_results from filters file")
    parser.add_argument("--no-enrich", action="store_true", help="Skip enrichment (search + score + dedupe only, zero credits)")
    parser.add_argument("--dry-run", action="store_true", help="Same as --no-enrich")
    args = parser.parse_args()

    run_pipeline(
        filters_path=args.filters,
        threshold=args.threshold,
        max_results=args.max_results,
        do_enrich=not (args.no_enrich or args.dry_run),
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
