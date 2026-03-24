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

export function buildEmailBisonUrl(instanceUrl: string, emailBisonId: string): string {
  return `${instanceUrl}/inbox/replies/${emailBisonId}`;
}

export function clsx(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}
