import type { SelectPickerOption } from "../../components/ui/SelectPicker";

// Suggestion catalog mirrored from DataGovernance/Iso3166Alpha2CountryCodes.cs.
// Guest nationality accepts any two ASCII letters: this list is NOT a wire whitelist.
export const nationalityCountryCodes = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ " +
  "BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ " +
  "DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU " +
  "ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ " +
  "LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
  "NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA " +
  "RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ " +
  "TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
).split(" ");

const aliases: Record<string, string[]> = {
  GB: ["UK", "Britain", "Great Britain", "United Kingdom"],
  US: ["USA", "United States", "United States of America"],
  AE: ["UAE", "United Arab Emirates"],
};

export function normalizeNationalityValue(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

export function nationalityOptions(storedValue: string | null | undefined, locales: readonly string[] = ["en"]): SelectPickerOption[] {
  const names = [...new Set([...locales, "en"])].flatMap(locale => {
    try { return [new Intl.DisplayNames([locale], { type: "region", fallback: "none" })]; }
    catch { return []; } // Invalid locale/missing Intl support cannot hide a valid code.
  });
  const options: SelectPickerOption[] = nationalityCountryCodes.map(code => {
    const labels = names.flatMap(displayNames => { const label = displayNames.of(code); return label ? [label] : []; });
    return {
      value: code,
      label: labels.length ? `${labels[0]} (${code})` : code,
      searchTerms: [...new Set([...labels, ...(aliases[code] ?? [])])],
      searchCodes: [code, ...(aliases[code]?.filter(alias => /^[A-Z]{2,3}$/.test(alias)) ?? [])],
    };
  }).sort((left, right) => left.label.localeCompare(right.label));
  const stored = normalizeNationalityValue(storedValue);
  if (stored && !options.some(option => option.value === stored)) {
    options.unshift({ value: stored, label: `Stored code (${stored})`, disabled: !/^[A-Z]{2}$/.test(stored), searchCodes: [stored] });
  }
  return options;
}
