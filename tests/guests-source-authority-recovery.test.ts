import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GuestProfile } from "../src/api/types";
import {
  guestMutationAllowed,
  guestRecordMatches,
} from "../src/features/guests/guestsMutationAuthority";

const repositoryRoot = process.cwd();

function source(path: string): string {
  return readFileSync(join(repositoryRoot, "src", ...path.split("/")), "utf8")
    .replaceAll("\r\n", "\n");
}

describe("guests source authority recovery", () => {
  it("requires only the current evidence consumed by each Guest Record command", () => {
    expect(guestMutationAllowed("create", {
      permissionsCurrent: true,
    })).toBe(true);
    expect(guestMutationAllowed("update", {
      permissionsCurrent: true,
      guestCurrent: true,
    })).toBe(true);
    expect(guestMutationAllowed("archive", {
      permissionsCurrent: true,
      guestCurrent: true,
    })).toBe(true);

    for (const action of ["create", "update", "archive"] as const) {
      expect(guestMutationAllowed(action, {
        permissionsCurrent: false,
        guestCurrent: true,
      })).toBe(false);
    }

    expect(guestMutationAllowed("update", {
      permissionsCurrent: true,
      guestCurrent: false,
    })).toBe(false);
    expect(guestMutationAllowed("archive", {
      permissionsCurrent: true,
    })).toBe(false);
  });

  it("rejects update and archive commands after the Guest Record advances", () => {
    const candidate = guest();

    expect(guestRecordMatches(candidate, candidate)).toBe(true);
    expect(guestRecordMatches({ ...candidate, version: 8 }, candidate)).toBe(false);
    expect(guestRecordMatches({
      ...candidate,
      lastChangedAtUtc: "2026-08-23T10:01:00Z",
    }, candidate)).toBe(false);
    expect(guestRecordMatches({ ...candidate, status: 2 }, candidate)).toBe(false);
    expect(guestRecordMatches({ ...candidate, guestId: "guest-b" }, candidate)).toBe(false);

    // A Guest Record may be visible from a property other than where it began.
    expect(guestRecordMatches({
      ...candidate,
      originPropertyId: "property-b",
    }, candidate)).toBe(true);
  });

  it("preserves independent snapshots and gates every Guest Record mutation path", () => {
    const page = source("features/guests/GuestsPage.tsx");

    expect(page).toContain("const permissionSource = createCompositeSource({");
    expect(page).toContain("const directorySource = createCompositeSource({");
    expect(page).toContain("const detailSource = createCompositeSource({");
    expect(page).toContain("const staysSource = createCompositeSource({");
    expect(page).toContain("guestRecordMatches(detail.data, guest)");
    expect(page).toContain("propertyId: selectedPropertyId");
    expect(page).toContain("selectedPropertyIdRef.current !== submission.propertyId");
    expect(page).toContain("if (!mayRead) {");
    expect(page).toContain("state={guestDataVisible ? formState : undefined}");
    expect(page).toContain("setFormState(undefined);");
    expect(page).toContain("setArchiveTarget(null);");
    expect(page).toContain("<CompositeSourceNotice");
    expect(page).toContain("<CompositeSourceFallback");
    expect(page).toContain("disabled={!authorityCurrent}");
    expect(page).not.toContain("placeholderData:");
    expect(page).not.toContain("guests.error ?");
    expect(page).not.toContain("detail.error ?");
  });
});

function guest(): GuestProfile {
  return {
    guestId: "guest-a",
    originPropertyId: "property-a",
    displayName: "Maya Chen",
    legalName: null,
    email: "maya@example.test",
    phone: null,
    dateOfBirth: null,
    nationalityCountryCode: null,
    preferredLanguageTag: null,
    notes: null,
    status: 1,
    version: 7,
    createdBy: "staff:test",
    createdAtUtc: "2026-08-23T09:00:00Z",
    lastChangedBy: "staff:test",
    lastChangedAtUtc: "2026-08-23T10:00:00Z",
    archivedAtUtc: null,
  };
}
