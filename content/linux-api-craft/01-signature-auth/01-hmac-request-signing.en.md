+++
title = "Signed Panel API Client & IP Allowlist Hardening"
summary = "Build a hardened Linux panel API client with strict TLS verification, timeouts, and static CIDR allowlists."
step_number = 1
estimated_minutes = 9
synced_revision = 2
canonical_revision = 2
tags = ["Python", "Linux", "API", "Security"]
+++

## Hardening Before Your First API Request

:::danger[Never Leave Wildcard * IP Allowlists in Production]
While `*` wildcard allowlists are convenient on isolated VMs, exposing an unpinned panel endpoint on the public internet invites full server takeover. Lock the allowlist to your WireGuard or static egress IP.
:::

- [ ] Lock the panel API allowlist to your static egress IP or WireGuard CIDR | Remove wildcard `*` entries and store the API key in environment variables

## Building a Signed Client with Strict TLS & Timeouts

```python title="scripts/panel_client.py"
import time, hashlib, requests

class SafePanelClient:
    def __init__(self, base_url: str, api_key: str, timeout: int = 10):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def _build_auth_payload(self) -> dict:
        now_ts = int(time.time())
        key_md5 = hashlib.md5(self.api_key.encode("utf-8")).hexdigest()
        token = hashlib.md5(f"{now_ts}{key_md5}".encode("utf-8")).hexdigest()
        return {"request_time": now_ts, "request_token": token}
```

- [ ] Run a read-only status call through `SafePanelClient` | Confirm `verify=True` and request timeouts succeed cleanly
