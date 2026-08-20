export function isValidLosAngelesDateTime(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?([+-])(\d{2}):(\d{2})$/);
  if (!match) return false;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  if (part("year") !== match[1] || part("month") !== match[2] || part("day") !== match[3] ||
    part("hour") !== match[4] || part("minute") !== match[5] || part("second") !== (match[6] ?? "00")) return false;
  const localAsUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? "00"));
  const actualOffsetMinutes = (localAsUtc - instant.getTime()) / 60_000;
  const suppliedOffsetMinutes = (match[7] === "+" ? 1 : -1) * (Number(match[8]) * 60 + Number(match[9]));
  return actualOffsetMinutes === suppliedOffsetMinutes;
}
