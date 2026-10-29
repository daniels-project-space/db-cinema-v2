/** Shared preference ranking for complementary lens picks. Compatibility and
 * live stock are checked separately; this only decides which valid fit to show first. */
export const isAnamorphic = (title: string) => /\banamorphic\b/i.test(title || "");

/** Prefer one useful lens before multi-focal or duplicate-lens packs. */
export const isLensSet = (title: string) => {
  const normalized = String(title || "").replace(/[–—−]/g, "-");
  return /\bultimate\b|\blens (?:set|kit|bundle)\b|\d-?lens/i.test(normalized) ||
    /\b[2-9]\d*\s*[x×]\s*/i.test(normalized) ||
    ((normalized.match(/\d{2,3}\s*-\s*\d{2,3}/g) || []).length >= 3);
};

/** Native flagship glass and versatile single-lens options lead when they fit. */
export function lensPriority(title: string, cameraMounts: string[] = []): number {
  const text = String(title || "").replace(/[–—−]/g, "-").toLowerCase();
  let score = 0;
  const sony = cameraMounts.includes("E");
  const efpl = cameraMounts.includes("EF") || cameraMounts.includes("PL") || cameraMounts.includes("RF");
  if (sony && /\bg ?master\b|gmaster|\bgm\b/.test(text) && /\bsony\b/.test(text)) score += 18;
  if (sony && /\b(sigma|tamron|samyang|rokinon|viltrox)\b/.test(text)) score -= 4;
  if (efpl && isAnamorphic(text)) score += 22;
  if (efpl && /\bcanon\b|\bef\b/.test(text) && /\bl\b|usm|f2\.8 l|f4 l|l series/.test(text)) score += 16;
  else if (efpl && (/\bcanon\b/.test(text) || /\bef\b/.test(text))) score += 8;
  if (/24-?70/.test(text)) score += 4;
  if (isLensSet(text)) score -= 18;
  return score;
}
