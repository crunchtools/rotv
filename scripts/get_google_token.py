#!/usr/bin/env python3
"""Get Google OAuth refresh token for Google Workspace MCP."""

import os
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/presentations",
]

CONFIG_DIR = Path.home() / ".config" / "google-workspace-mcp"
CREDENTIALS_FILE = CONFIG_DIR / "credentials.json"
TOKEN_ENV_FILE = CONFIG_DIR / "token_env.txt"
OAUTH_CALLBACK_PORT = 8085


def main():
    flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
    creds = flow.run_local_server(port=OAUTH_CALLBACK_PORT)

    # The credentials go to one place: a 0600 file. They used to be printed as
    # well, which put a client secret and a refresh token into the terminal
    # scrollback, the shell's session log and anything collecting this script's
    # stdout -- for no gain, since the file already holds all three.
    #
    # 0o600 is set before anything is written, not chmod-ed afterwards: a file
    # created under the default mask is world-readable for as long as that
    # takes.
    fd = os.open(TOKEN_ENV_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(f"GOOGLE_WORKSPACE_CLIENT_ID={creds.client_id}\n")
        f.write(f"GOOGLE_WORKSPACE_CLIENT_SECRET={creds.client_secret}\n")
        f.write(f"GOOGLE_WORKSPACE_REFRESH_TOKEN={creds.refresh_token}\n")

    print("\n" + "=" * 60)
    print(
        f"Wrote GOOGLE_WORKSPACE_CLIENT_ID, _CLIENT_SECRET and _REFRESH_TOKEN to\n  {TOKEN_ENV_FILE}"
    )
    print("Copy them into your MCP server configuration from there.")
    print("=" * 60)


if __name__ == "__main__":
    main()
