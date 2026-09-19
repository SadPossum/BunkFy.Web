# Guest language suggestions

Source: [IANA Language Subtag Registry](https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry), retrieved 2026-09-13; File-Date 2026-08-08. Source SHA-256: `be21e91b6851f750a7b1a687f11209d46ad5a8471d6b10a1efc8d1dac4c8a926`.

The [IANA/IETF registry licensing statement](https://www.iana.org/help/licensing-terms) applies the CC0 1.0 dedication to protocol registries. Registry data is supplied without warranty; this note is source provenance, not legal/product admission.

`node scripts/generate-guest-language-catalog.mjs [optional-local-registry-file]` validates the pinned source hash and generates/checks the deterministic JSON artifact. It refuses changed source or an existing differing output. Review a registry update before changing the pin; never rewrite saved Guest values as a side effect.

The artifact contains 8,043 non-deprecated exact base-language subtags and all their Description aliases, not every valid script/region/extension combination. Deprecated language values are not new suggestions; saved values remain visible and removable without substitution. The search index does not validate accepted wire tags. Exact-tag entry preserves advanced regional/script/legacy cases.

Generated artifact: 168,457 bytes, SHA-256 `5b4be497533c3b345c38ac19aec7fd36c1f38c4c8e803c3594d3387de615e70e`. The source names `ksh` as Kölsch; runtime English DisplayNames may call it Colognian. Uncommon localized synonyms absent from the registry are not guaranteed searchable before selection; do not claim every locale's synonym coverage from this dataset.

Load the static bundled data only on picker opening, then cache it. Do not fetch IANA from an operator browser. English registry names/aliases and codes are searchable. Two-letter core names also use the current browser locale; less-common registry descriptions remain English. Saved values use a localized name where the runtime knows one, with their original code shown. This is not a full product localization claim.

Bound rendered search results. Failure to load suggestions must be recoverable without losing selected values or authorizing a form write. Real browser startup/typing cost, narrow layout, keyboard and all three form integrations must be verified separately from catalog unit tests.
