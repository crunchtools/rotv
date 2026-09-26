#!/usr/bin/env python3
"""Get Google OAuth refresh token for Google Workspace MCP."""

from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/presentations',
]

CONFIG_DIR = Path.home() / '.config' / 'google-workspace-mcp'
CREDENTIALS_FILE = CONFIG_DIR / 'credentials.json'
TOKEN_ENV_FILE = CONFIG_DIR / 'token_env.txt'
OAUTH_CALLBACK_PORT = 8085

def main():
    flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
    creds = flow.run_local_server(port=OAUTH_CALLBACK_PORT)

    print("\n" + "="*60)
    print("Add these to your MCP server configuration:")
    print("="*60)
    print(f"\nGOOGLE_WORKSPACE_CLIENT_ID={creds.client_id}")
    print(f"GOOGLE_WORKSPACE_CLIENT_SECRET={creds.client_secret}")
    print(f"GOOGLE_WORKSPACE_REFRESH_TOKEN={creds.refresh_token}")
    print("\n" + "="*60)

    # Save to file
    with open(TOKEN_ENV_FILE, 'w') as f:
        f.write(f"GOOGLE_WORKSPACE_CLIENT_ID={creds.client_id}\n")
        f.write(f"GOOGLE_WORKSPACE_CLIENT_SECRET={creds.client_secret}\n")
        f.write(f"GOOGLE_WORKSPACE_REFRESH_TOKEN={creds.refresh_token}\n")
    print(f"Saved to {TOKEN_ENV_FILE}")

if __name__ == '__main__':
    main()
