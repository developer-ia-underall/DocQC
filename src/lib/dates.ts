/** Timezone helpers used by metadata rewriting. */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  try {
    const s =
      new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
        .formatToParts(date)
        .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    const m = s.match(/GMT([+-])(\d{2}):?(\d{2})?/);
    if (!m) return 0;
    const v = parseInt(m[2] ?? "0") * 60 + parseInt(m[3] ?? "0");
    return m[1] === "-" ? -v : v;
  } catch {
    return 0;
  }
}
function local(date: Date, off: number) {
  const d = new Date(date.getTime() + off * 60000);
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    y: d.getUTCFullYear(),
    M: p(d.getUTCMonth() + 1),
    d: p(d.getUTCDate()),
    h: p(d.getUTCHours()),
    m: p(d.getUTCMinutes()),
    s: p(d.getUTCSeconds()),
  };
}
export function pdfDate(date: Date, tz: string) {
  const off = tzOffsetMinutes(date, tz);
  const l = local(date, off);
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return `D:${l.y}${l.M}${l.d}${l.h}${l.m}${l.s}${sign}${String(Math.floor(a / 60)).padStart(2, "0")}'${String(a % 60).padStart(2, "0")}'`;
}
export function isoWithOffset(date: Date, tz: string) {
  const off = tzOffsetMinutes(date, tz);
  const l = local(date, off);
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return `${l.y}-${l.M}-${l.d}T${l.h}:${l.m}:${l.s}${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}
export const isoUtcSeconds = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
/** Parse PDF "D:YYYYMMDDHHmmSS+HH'mm'" into ISO; returns also whether it was UTC/zero-offset. */
export function parsePdfDate(raw?: string): { iso?: string | undefined; utc: boolean } {
  if (!raw) return { utc: false };
  const m = raw.match(
    /D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/,
  );
  if (!m) return { utc: false };
  const [, y, M = "01", d = "01", h = "00", mi = "00", s = "00", sign, oh = "00", om = "00"] = m;
  const utc = !sign || sign.toUpperCase() === "Z" || (oh === "00" && om === "00");
  const off = !sign || sign.toUpperCase() === "Z" ? "Z" : `${sign}${oh}:${om}`;
  const iso = new Date(`${y}-${M}-${d}T${h}:${mi}:${s}${off}`);
  return { iso: isNaN(iso.getTime()) ? undefined : iso.toISOString(), utc };
}
export function parseApp(application: string): { name: string; version: string } {
  const m = application.trim().match(/^(.*?)\s+v?(\d+(?:\.\d+)*)$/);
  return m ? { name: m[1] ?? "", version: m[2] ?? "" } : { name: application.trim(), version: "" };
}
