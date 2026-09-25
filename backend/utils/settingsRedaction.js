// Shared by the admin HTTP route and the MCP admin server so the two can't
// drift. The MCP settings_list tool used to return every value verbatim,
// and the HTTP route's name match (api_key/token) missed twitter_cookies,
// which carries the X auth_token session cookie.
const SECRET_KEY_PATTERN = /(api_key|token|secret|password|cookie)/i;

export function isSecretSetting(key) {
  return SECRET_KEY_PATTERN.test(key);
}

// Secrets expose only whether they are set; everything else passes through.
export function redactSettingRow(row) {
  if (isSecretSetting(row.key)) {
    return { key: row.key, isSet: !!row.value, updated_at: row.updated_at };
  }
  return row;
}
