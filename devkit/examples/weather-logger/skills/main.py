"""weather-logger — fetch current conditions and store them in memory.

Demonstrates: http.post_json, s3.put, a freshness validator, and an
invariant validator (the output must mention "temperature").
"""

import json
import sys

from _tools import s3_put, http_post_json, metrics_record, KohalaToolError


def main():
    # Open-Meteo is free and needs no API key. (POST works for parity with
    # the http.post_json tool; the API ignores the empty body.)
    response = http_post_json(
        "https://api.open-meteo.com/v1/forecast"
        "?latitude=21.31&longitude=-157.86&current=temperature_2m,weather_code",
        {},
    )
    if not response["ok"]:
        print(f"weather API returned {response['status']}", file=sys.stderr)
        raise SystemExit(1)

    current = (response["json"] or {}).get("current", {})
    temperature = current.get("temperature_2m")
    if temperature is None:
        print("weather API response had no temperature", file=sys.stderr)
        raise SystemExit(1)

    report = json.dumps({"temperature_c": temperature, "raw": current})
    s3_put("weather/latest", report)
    metrics_record("temperature_c", float(temperature))

    print(f"stored weather/latest: temperature {temperature}°C")


if __name__ == "__main__":
    main()
