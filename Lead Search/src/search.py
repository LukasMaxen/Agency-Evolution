from .apollo_client import ApolloClient

PAGE_SIZE = 100
MAX_PAGES = 500

NON_FILTER_KEYS = ("relevance", "max_results", "enrich_email", "enrich_phone")


def run_people_search(client: ApolloClient, filters: dict, max_results: int, verbose=True):
    results = []
    page = 1
    search_filters = {k: v for k, v in filters.items() if k not in NON_FILTER_KEYS}

    while True:
        payload = {**search_filters, "page": page, "per_page": PAGE_SIZE}
        data = client.people_search(payload)
        people = data.get("people", [])
        if not people:
            break
        results.extend(people)
        if verbose:
            print(f"  page {page}: +{len(people)} (total {len(results)})")

        total_entries = (data.get("pagination") or {}).get("total_entries")

        if max_results and len(results) >= max_results:
            results = results[:max_results]
            break
        if page >= MAX_PAGES:
            break
        if total_entries is not None and page * PAGE_SIZE >= total_entries:
            break
        page += 1

    return results
