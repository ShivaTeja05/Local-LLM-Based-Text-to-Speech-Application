"""A one-screen health report for the Cloud Run deployment, from Cloud Logging and Cloud Run.

    python3 deploy/cloudrun/status.py            # last 3 hours
    python3 deploy/cloudrun/status.py --hours 24

Shows requests by endpoint and status, response times, rate-limit hits, errors, chat timings
(from the app's own log lines, which never contain what people typed) and the service's settings.
Needs only the gcloud CLI, signed in to the project's account.
"""

import argparse
import collections
import json
import re
import statistics
import subprocess

SERVICE, REGION = "ellie", "europe-west1"


def gcloud(*args: str) -> str:
    return subprocess.run(["gcloud", *args], capture_output=True, text=True, check=True).stdout


def logs(query: str, hours: int, limit: int = 5000) -> list[dict]:
    out = gcloud("logging", "read", query, f"--freshness={hours}h", f"--limit={limit}", "--format=json")
    return json.loads(out or "[]")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=int, default=3)
    hours = ap.parse_args().hours
    base = f'resource.type="cloud_run_revision" AND resource.labels.service_name="{SERVICE}"'

    print(f"== Ellie on Cloud Run: last {hours} h")
    svc = json.loads(gcloud("run", "services", "describe", SERVICE, f"--region={REGION}", "--format=json"))
    tpl = svc["spec"]["template"]
    ann = tpl["metadata"].get("annotations", {})
    limits = tpl["spec"]["containers"][0]["resources"]["limits"]
    print(f"URL {svc['status']['url']}  revision {svc['status']['latestReadyRevisionName']}")
    print(f"size {limits.get('cpu')} CPU / {limits.get('memory')}  instances "
          f"{ann.get('autoscaling.knative.dev/minScale', '0')}..{ann.get('autoscaling.knative.dev/maxScale', '?')}")

    reqs = logs(base + ' AND logName:"requests"', hours)
    print(f"\n-- requests: {len(reqs)}")
    by = collections.Counter()
    lat: dict[tuple, list[float]] = collections.defaultdict(list)
    for e in reqs:
        r = e.get("httpRequest", {})
        path = re.sub(r"\?.*", "", r.get("requestUrl", "").split(".run.app")[-1]) or "/"
        path = path if path.startswith("/api/") else "(app page)"
        key = (r.get("requestMethod"), path, r.get("status"))
        by[key] += 1
        if r.get("latency"):
            lat[key].append(float(r["latency"].rstrip("s")))
    for (method, path, status), n in sorted(by.items(), key=lambda kv: -kv[1])[:15]:
        times = lat.get((method, path, status), [])
        median = f"median {statistics.median(times):.2f}s" if times else ""
        print(f"  {n:5d}  {method:7} {path:20} {status}   {median}")

    def count(text: str) -> int:
        return len(logs(base + f' AND textPayload:"{text}"', hours, 1000))

    print(f"\n-- rate-limited requests: {count('rate limited')}")
    errors = logs(base + " AND severity>=ERROR", hours, 50)
    print(f"-- errors: {len(errors)}")
    for e in errors[:5]:
        print("   ", (e.get("textPayload") or json.dumps(e.get("jsonPayload", {})))[:140])

    chats = logs(base + ' AND textPayload:"app.api.chat: chat model="', hours, 1000)
    totals = [int(m.group(1)) for e in chats if (m := re.search(r"total_ms=(\d+)", e.get("textPayload", "")))]
    if totals:
        print(f"\n-- replies: {len(totals)}, median {statistics.median(totals) / 1000:.1f}s, "
              f"slowest {max(totals) / 1000:.1f}s")
    starts = count("Ollama ready with")
    print(f"-- cold starts (instance start-ups): {starts}")


if __name__ == "__main__":
    main()
