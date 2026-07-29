import os

import requests
from dotenv import load_dotenv
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

load_dotenv()

APOLLO_BASE_URL = "https://api.apollo.io/api/v1"


class ApolloAPIError(Exception):
    def __init__(self, status_code, message):
        self.status_code = status_code
        super().__init__(f"Apollo API error {status_code}: {message}")


class RateLimitError(Exception):
    pass


class ApolloClient:
    def __init__(self, api_key=None):
        self.api_key = api_key or os.getenv("APOLLO_API_KEY")
        if not self.api_key:
            raise RuntimeError("APOLLO_API_KEY not set. Add it to .env")
        self.session = requests.Session()
        self.session.headers.update(
            {
                "X-Api-Key": self.api_key,
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
        )

    @retry(
        retry=retry_if_exception_type(RateLimitError),
        wait=wait_exponential(multiplier=2, min=2, max=60),
        stop=stop_after_attempt(6),
    )
    def _post(self, path, payload):
        resp = self.session.post(f"{APOLLO_BASE_URL}{path}", json=payload, timeout=30)
        if resp.status_code == 429:
            raise RateLimitError(f"Rate limited on {path}")
        if resp.status_code >= 500:
            raise RateLimitError(f"Server error {resp.status_code} on {path}")
        if resp.status_code >= 400:
            raise ApolloAPIError(resp.status_code, resp.text[:500])
        return resp.json()

    def people_search(self, payload):
        return self._post("/mixed_people/api_search", payload)

    def people_bulk_match(self, payload):
        return self._post("/people/bulk_match", payload)

    def organization_search(self, payload):
        return self._post("/mixed_companies/search", payload)
