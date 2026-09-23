// @vitest-environment jsdom
import { act, type ComponentProps, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { GuestProfile, GuestStayHistoryItem } from "../src/api/types";
import type { CompositeSource } from "../src/app/compositeSourceState";
import { ApiError } from "../src/api/client";
import { GuestDetail, GuestEditor } from "../src/features/guests/GuestsPage";

const profile: GuestProfile = {
  guestId: "qa-guest", originPropertyId: "qa-property", displayName: "Maya Example", legalName: null,
  email: null, phone: null, dateOfBirth: null, nationalityCountryCode: null, preferredLanguageTag: null,
  languageTags: [], notes: null, status: 1, version: 7, createdBy: "staff:qa", createdAtUtc: "2026-09-01T10:00:00Z",
  lastChangedBy: "staff:qa", lastChangedAtUtc: "2026-09-20T10:00:00Z", archivedAtUtc: null,
};
const stay = (overrides: Partial<GuestStayHistoryItem> = {}): GuestStayHistoryItem => ({
  reservationId: "qa-stay-001", propertyId: "qa-property", arrival: "2026-09-21", departure: "2026-09-22",
  status: 2, role: 1, isCurrentParticipant: true, reservationVersion: 1, ...overrides,
});
const source = (overrides: Partial<CompositeSource> = {}): CompositeSource => ({ label: "Stay history", state: "ready", isFetching: false, refetch: vi.fn().mockResolvedValue(undefined), ...overrides });
const detailProps = (overrides: Partial<ComponentProps<typeof GuestDetail>> = {}): ComponentProps<typeof GuestDetail> => ({
  guest: profile, stays: [], staysSource: source(), stayPage: 1, stayPageSize: 8, staysHasMore: false,
  onStayPageChange: vi.fn(), canManage: true, canArchive: true, canOpenReservations: true,
  manageEnabled: true, archiveEnabled: true, onEdit: vi.fn(), onArchive: vi.fn(), ...overrides,
});
const editorProps = (overrides: Partial<ComponentProps<typeof GuestEditor>> = {}): ComponentProps<typeof GuestEditor> => ({
  state: profile, submitting: false, error: null, sources: [], authorityCurrent: true, authorityMessage: "Refresh this guest first.",
  recovery: null, recoveryAllowed: false, onRetry: vi.fn(), onSubmit: vi.fn(), onClose: vi.fn(), ...overrides,
});
const html = (element: ReactElement) => new DOMParser().parseFromString(renderToStaticMarkup(<MemoryRouter>{element}</MemoryRouter>), "text/html");
const buttons = (document: Document) => [...document.querySelectorAll("button")];

describe("real Guest Record detail composition", () => {
  it("has one dominant identity and honest minimal/empty sections without blank fact cards", () => {
    const document = html(<GuestDetail {...detailProps()} />);
    expect([...document.querySelectorAll("h3")].map(heading => heading.textContent)).toEqual(["Maya Example", "Identity and contact", "Stay history"]);
    expect(document.body.textContent?.match(/Maya Example/g)).toHaveLength(1);
    expect(document.querySelector("dl")).toBeNull();
    expect(document.body.textContent).toContain("Only the display name is recorded.");
    expect(document.body.textContent).toContain("Not recorded: legal name, email, phone, date of birth, nationality, languages.");
    expect(document.body.textContent).toContain("No stays recorded yet");
    expect(document.body.textContent).toContain("Profile version 7");
    expect(document.querySelector("#guest-staff-notes")).toBeNull();
  });

  it("preserves all facts, notes and links as semantic wrapping read values", () => {
    const long = "Alexandria".repeat(24), email = `${"guest".repeat(30)}@example.test`, notes = `${"context".repeat(60)}\nSecond line.`;
    const full = { ...profile, displayName: long, legalName: `${long} legal`, email, phone: "+44 7700 900123", dateOfBirth: "1990-06-12", nationalityCountryCode: "GB", preferredLanguageTag: "en-GB", languageTags: ["en-GB", "fr"], notes };
    const document = html(<GuestDetail {...detailProps({ guest: full })} />);
    expect([...document.querySelectorAll("dt")].map(node => node.textContent)).toEqual(["Legal name", "Email", "Phone", "Date of birth", "Nationality", "Languages"]);
    expect(document.querySelectorAll("dd")).toHaveLength(6);
    for (const value of document.querySelectorAll("dd")) expect(value.className).toContain("[overflow-wrap:anywhere]");
    expect(document.querySelector("h3")?.className).toContain("[overflow-wrap:anywhere]");
    expect(document.querySelector('a[href^="mailto:"]')?.textContent).toBe(email);
    expect(document.querySelector('a[href^="tel:"]')?.textContent).toBe(full.phone);
    const renderedNotes = document.querySelector('[aria-labelledby="guest-staff-notes"] p')!;
    expect(renderedNotes.textContent).toBe(notes);
    expect(renderedNotes.className).toContain("whitespace-pre-wrap");
    expect(renderedNotes.className).toContain("[overflow-wrap:anywhere]");
    expect(document.body.textContent).not.toContain("Not recorded:");
    expect(document.querySelector('[aria-labelledby="guest-profile-details"]')!.compareDocumentPosition(document.querySelector('[aria-labelledby="guest-stay-history"]')!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it.each([1, 3, 8])("renders %s stays as consistent rows without losing status, lifecycle, participant or target", count => {
    const stays = Array.from({ length: count }, (_, index) => stay({ reservationId: `qa-stay-00${index}`, ...(index % 2 ? { status: 10, checkedOutBusinessDate: "2026-09-22", isCurrentParticipant: false } : {}) }));
    const document = html(<GuestDetail {...detailProps({ stays, staysHasMore: count === 8 })} />);
    expect(document.querySelectorAll("article")).toHaveLength(count);
    for (const [index, row] of [...document.querySelectorAll("article")].entries()) {
      expect(row.querySelectorAll("time")).toHaveLength(2);
      expect(row.textContent).toContain("1 night · primary guest");
      expect(row.textContent).toContain(index % 2 ? "Checked out" : "Stay not started");
      expect(row.textContent).toContain(index % 2 ? "Historical participant" : "Current participant");
      expect(row.lastElementChild?.tagName).toBe("A");
      const target = new URL(row.querySelector("a")!.href, "https://example.test");
      expect(target.searchParams.get("property")).toBe("qa-property");
      expect(target.searchParams.get("reservation")).toBe(stays[index].reservationId);
      expect(target.searchParams.get("focus")).toBe(stays[index].reservationId);
    }
    expect(document.querySelector('[aria-label="Next stay page"]') !== null).toBe(count === 8);
  });

  it.each(["read-only", "stale", "archived"])("keeps %s actions honest without hiding recorded information", condition => {
    const document = html(<GuestDetail {...detailProps({ stays: [stay()], ...(condition === "read-only" ? { canManage: false, canArchive: false, canOpenReservations: false } : condition === "stale" ? { manageEnabled: false, archiveEnabled: false } : { guest: { ...profile, status: 2 } }) })} />);
    const management = buttons(document).filter(button => ["Edit", "Archive"].includes(button.textContent ?? ""));
    expect(management).toHaveLength(condition === "stale" ? 2 : 0);
    for (const button of management) expect(button.disabled).toBe(true);
    expect(document.querySelectorAll("article")).toHaveLength(1);
    expect(document.querySelectorAll('a[href^="/reservations"]')).toHaveLength(condition === "read-only" ? 0 : 1);
  });

  it.each(["loading", "unavailable", "stale", "refreshing"] as const)("retains independent profile facts while stay history is %s", condition => {
    const document = html(<GuestDetail {...detailProps({ guest: { ...profile, email: "guest@example.test" }, stays: [stay()], stayPage: 2, staysHasMore: true, staysSource: source({ state: condition === "refreshing" ? "ready" : condition, isFetching: condition === "refreshing" }) })} />);
    expect(document.querySelector("dd")?.textContent).toBe("guest@example.test");
    if (condition === "loading") expect(document.body.textContent).toContain("Loading stay history");
    if (condition === "unavailable") expect(document.body.textContent).toContain("Stay history unavailable");
    if (condition === "stale") expect(document.body.textContent).toContain("last confirmed snapshot");
    expect(document.querySelectorAll("article")).toHaveLength(["stale", "refreshing"].includes(condition) ? 1 : 0);
    for (const button of buttons(document).filter(button => button.getAttribute("aria-label")?.includes("stay page"))) expect(button.disabled).toBe(true);
  });

  it("keeps edit, archive and pagination handlers attached to the displayed record", () => {
    const props = detailProps({ stays: [stay()], staysHasMore: true, stayPage: 2 });
    const container = document.createElement("div"), root = createRoot(container);
    document.body.append(container);
    try {
      act(() => root.render(<MemoryRouter><GuestDetail {...props} /></MemoryRouter>));
      const findButton = (label: string) => [...container.querySelectorAll("button")].find(button => button.textContent === label)!;
      act(() => findButton("Edit").click()); expect(props.onEdit).toHaveBeenCalledOnce();
      act(() => findButton("Archive").click()); expect(props.onArchive).toHaveBeenCalledOnce();
      act(() => container.querySelector<HTMLButtonElement>('[aria-label="Previous stay page"]')!.click());
      act(() => container.querySelector<HTMLButtonElement>('[aria-label="Next stay page"]')!.click());
      expect(props.onStayPageChange).toHaveBeenNthCalledWith(1, 1);
      expect(props.onStayPageChange).toHaveBeenNthCalledWith(2, 3);
    } finally { act(() => root.unmount()); container.remove(); }
  });
});

describe("real Guest editor shared composition", () => {
  it.each([null, { ...profile, notes: "Synthetic note; not the control label." }])("keeps the notes label concise and the privacy hint a separate description", state => {
    const document = html(<GuestEditor {...editorProps({ state })} />);
    const notes = document.querySelector<HTMLTextAreaElement>('textarea[name="notes"]')!;
    expect([...notes.labels!].map(label => label.textContent)).toEqual(["Staff notes (optional)"]);
    const descriptionId = notes.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)?.textContent).toBe("Visible to staff who can read Guest Records at this property.");
    expect(notes.labels![0].contains(document.getElementById(descriptionId!))).toBe(false);
    expect(notes.value).toBe(state?.notes ?? "");
  });

  it.each([null, profile])("keeps create/edit fields in their existing order with native names and limits", state => {
    const document = html(<GuestEditor {...editorProps({ state })} />);
    expect([...document.querySelectorAll("h3")].map(heading => heading.textContent)).toEqual(["Identity", "Contact", "Additional details", "Staff context"]);
    expect([...document.querySelectorAll("input[name], textarea[name]")].map(input => input.getAttribute("name"))).toEqual(["displayName", "legalName", "email", "phone", "dateOfBirth", "nationalityCountryCode", "notes"]);
    const name = document.querySelector<HTMLInputElement>('input[name="displayName"]')!;
    expect(name.required).toBe(true); expect(name.maxLength).toBe(256); expect(name.autocomplete).toBe("name");
    expect(document.querySelector<HTMLTextAreaElement>("textarea")!.maxLength).toBe(4000);
    expect(document.body.textContent).toContain("Visible to staff who can read Guest Records at this property.");
    expect(buttons(document).filter(button => button.type === "submit")[0].textContent).toBe(state ? "Save changes" : "Create guest record");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps an error before the disabled fields and preserves the cancel path", () => {
    const document = html(<GuestEditor {...editorProps({ authorityCurrent: false, error: new ApiError("Profile changed. Refresh before saving.", 409) })} />);
    expect(document.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true);
    expect(document.body.textContent).toContain("Refresh this guest first.");
    expect(document.body.textContent).toContain("Profile changed. Refresh before saving.");
    expect(document.querySelector("form")!.firstElementChild?.compareDocumentPosition(document.querySelector("fieldset")!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(buttons(document).find(button => button.textContent === "Save changes")?.disabled).toBe(true);
    expect(buttons(document).find(button => button.textContent === "Cancel")?.disabled).toBe(false);
  });

  it("preserves a dirty draft and field order across parent currentness updates", () => {
    const container = document.createElement("div"), root = createRoot(container);
    document.body.append(container);
    try {
      act(() => root.render(<GuestEditor {...editorProps()} />));
      const name = container.querySelector<HTMLInputElement>('input[name="displayName"]')!;
      name.value = "Alexandria Example with a long distinguishing suffix";
      act(() => root.render(<GuestEditor {...editorProps({ authorityCurrent: false })} />));
      expect(container.querySelector('input[name="displayName"]')).toBe(name);
      expect(name.value).toBe("Alexandria Example with a long distinguishing suffix");
      expect(container.querySelector<HTMLFieldSetElement>("fieldset")!.disabled).toBe(true);
      act(() => root.render(<GuestEditor {...editorProps()} />));
      expect(name.value).toBe("Alexandria Example with a long distinguishing suffix");
      expect(container.querySelector<HTMLFieldSetElement>("fieldset")!.disabled).toBe(false);
    } finally { act(() => root.unmount()); container.remove(); }
  });
});
