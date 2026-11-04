"""Sign in to Garmin once on your own computer and hand the tokens to Tempo.

Garmin often blocks sign-ins from cloud servers, so the reliable way to connect is to
sign in here (MFA supported), then either paste the printed tokens into the app
(Settings -> Garmin account -> Paste tokens) or let this script send them straight to
your server:

    pip install garminconnect
    python scripts/garmin_login.py                                   # print tokens
    python scripts/garmin_login.py --app https://your-app.vercel.app --key YOUR_ACCESS_KEY

Your password is only used for this one sign-in and is never saved. The tokens it
creates last for months; the server keeps them fresh after that.
"""

from __future__ import annotations

import argparse
import getpass
import json
import sys
import urllib.request


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--app", help="Your Tempo server address, e.g. https://tempo-yourname.vercel.app")
    parser.add_argument("--key", help="Your APP_ACCESS_KEY")
    parser.add_argument("--email", help="Garmin account email (asked for if missing)")
    args = parser.parse_args()

    try:
        from garminconnect import Garmin
    except ImportError:
        sys.exit("Install the Garmin library first:  pip install garminconnect")

    email = args.email or input("Garmin email: ").strip()
    password = getpass.getpass("Garmin password (not stored): ")
    client = Garmin(email, password, prompt_mfa=lambda: input("Code Garmin sent you: ").strip())
    client.login()
    tokens = client.client.dumps()
    print(f"\nSigned in as {client.get_full_name()}.")

    if args.app and args.key:
        req = urllib.request.Request(
            args.app.rstrip("/") + "/api/garmin/tokens",
            data=json.dumps({"tokens": tokens}).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {args.key}"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as res:
            body = json.loads(res.read())
        print(f"Sent to {args.app}: connected = {body.get('connected')}. Open the app and pull to refresh.")
    else:
        print("\nPaste everything between the lines into Tempo -> Settings -> Garmin account -> Paste tokens")
        print("(or set it as the GARMIN_TOKENS environment variable in Vercel):\n")
        print("-" * 60)
        print(tokens)
        print("-" * 60)
        print("\nTreat this like a password: it gives access to your Garmin account.")


if __name__ == "__main__":
    main()
