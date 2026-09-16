"""{{AGENT_NAME}} — main skill."""

import sys
import time

from _tools import s3_put, s3_list, notify_send, metrics_record, run_context


def main():
    context = run_context()
    if context["repair_attempt"] > 0:
        print(f"repair attempt {context['repair_attempt']}: {context['validator_feedback']}",
              file=sys.stderr)

    fact = f"Shift ran at {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}."
    s3_put("{{AGENT_NAME}}/latest", fact)
    notify_send("dev", "shift completed")
    metrics_record("facts_stored", 1)
    existing = s3_list(prefix="{{AGENT_NAME}}/")
    print(fact)
    print(f"memory now holds {len(existing['records'])} asset(s) under '{{AGENT_NAME}}/'")


if __name__ == "__main__":
    main()