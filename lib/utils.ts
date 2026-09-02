export function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function applyTemplate(body: string, leadName: string): string {
  const firstName = leadName.split(" ")[0];
  return body.replace(/{{first_name}}/g, firstName);
}

// Deep link to a specific reply's thread. Must be built from the reply's EmailBison UUID
// (DB column email_bison_id) — NOT email_bison_reply_id, which is a different, numeric EB
// id that looks plausible but 404s here. Confirmed working 2026-09-03 against a live thread.
export function buildEmailBisonUrl(instanceUrl: string, emailBisonUuid: string): string {
  return `${instanceUrl}/inbox/replies/${emailBisonUuid}`;
}

export function clsx(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

// Escapes literal control characters (0x00-0x1f) inside JSON string values.
// Claude occasionally emits bare newlines inside reply_body instead of \n,
// causing JSON.parse to throw "Bad control character in string literal".
// Only characters inside strings are touched — structural whitespace is left alone.
export function sanitizeJsonControlChars(str: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    const code = str.charCodeAt(i);
    if (escaped) { out += c; escaped = false; continue; }
    if (c === "\\" && inString) { out += c; escaped = true; continue; }
    if (c === '"') { inString = !inString; out += c; continue; }
    if (inString && code <= 0x1f) {
      if (c === "\n") out += "\\n";
      else if (c === "\r") out += "\\r";
      else if (c === "\t") out += "\\t";
      else out += `\\u${code.toString(16).padStart(4, "0")}`;
      continue;
    }
    out += c;
  }
  return out;
}
