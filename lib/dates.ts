const shortDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const longDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "long",
  day: "numeric",
  year: "numeric",
});

const time = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parse(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatUtcDate(value: string | Date, style: "short" | "long" = "short"): string {
  const date = parse(value);
  if (!date) return "—";
  return (style === "long" ? longDate : shortDate).format(date);
}

export function formatUtcDateTime(value: string | Date): string {
  const date = parse(value);
  if (!date) return "—";
  return `${shortDate.format(date)} · ${time.format(date)} UTC`;
}

export function formatUtcAuditTime(value: string | Date): string {
  const date = parse(value);
  if (!date) return "—";
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
