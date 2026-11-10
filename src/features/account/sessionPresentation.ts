/** A client-reported browser label, never proof of a physical device or identity. */
export function sessionDeviceLabel(userAgent?: string | null): string {
  if (!userAgent?.trim()) return "Device details not recorded";
  const value = userAgent.slice(0, 512);
  const browser = /Edg(?:e|A|iOS)?\//i.test(value) ? "Edge"
    : /OPR\//i.test(value) ? "Opera"
    : /SamsungBrowser\//i.test(value) ? "Samsung Internet"
    : /Firefox\/|FxiOS\//i.test(value) ? "Firefox"
    : /Chrome\/|Chromium\/|CriOS\//i.test(value) ? "Chrome"
    : /Version\/.*Safari\//i.test(value) ? "Safari" : null;
  const system = /iPhone|iPad|iPod/i.test(value) ? "iOS"
    : /Android/i.test(value) ? "Android"
    : /CrOS/i.test(value) ? "ChromeOS"
    : /Windows NT/i.test(value) ? "Windows"
    : /Macintosh|Mac OS X/i.test(value) ? "macOS"
    : /Linux/i.test(value) ? "Linux" : null;
  return browser && system ? `${browser} on ${system}`
    : browser ?? (system ? `Browser on ${system}` : "Browser details unavailable");
}

export function sessionActivityDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
