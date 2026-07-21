import type { components } from "./contracts.generated";

type Schema<Name extends keyof components["schemas"]> = components["schemas"][Name];
type NonNullableFields<T, Keys extends keyof T> = Omit<T, Keys> & {
  [Key in Keys]-?: NonNullable<T[Key]>;
};

export type EntityStatus = "active" | "retired" | string;

export type OrganizationStatus = Schema<"OrganizationStatus">;
export type OrganizationMembershipRole = Schema<"OrganizationMembershipRole">;
export type OrganizationMembershipStatus = Schema<"OrganizationMembershipStatus">;

export type Organization = NonNullableFields<
  Schema<"OrganizationDto">,
  "scopeId" | "name" | "slug"
>;

export type OrganizationMembership = NonNullableFields<
  Schema<"OrganizationMembershipDto">,
  "subjectId"
>;

export type OrganizationMembershipSummary = {
  organization: Organization;
  membership: OrganizationMembership;
};

export type OrganizationListResponse = Omit<Schema<"OrganizationListResponse">, "items"> & {
  items: OrganizationMembershipSummary[];
};

export type OrganizationMemberListResponse = Omit<Schema<"OrganizationMemberListResponse">, "items"> & {
  items: OrganizationMembership[];
};

export type OrganizationInvitation = NonNullableFields<
  Schema<"OrganizationInvitationDto">,
  "inviterSubjectId"
>;

export type OrganizationInvitationIssued = Omit<
  Schema<"OrganizationInvitationIssuedDto">,
  "invitation" | "token"
> & {
  invitation: OrganizationInvitation;
  token: string;
};

export type OrganizationInvitationPreview = NonNullableFields<
  Schema<"OrganizationInvitationPreviewDto">,
  "organizationName" | "organizationSlug"
>;

export type OrganizationInvitationAcceptance = Omit<
  Schema<"OrganizationInvitationAcceptanceDto">,
  "invitation" | "membership"
> & {
  invitation: OrganizationInvitation;
  membership: OrganizationMembershipSummary;
};

export type OrganizationEnrollmentPreview = NonNullableFields<
  Schema<"OrganizationEnrollmentPreviewDto">,
  "organizationName" | "organizationSlug"
>;

export type OrganizationEnrollmentLink = NonNullableFields<
  Schema<"OrganizationEnrollmentLinkDto">,
  "creatorSubjectId"
>;

export type OrganizationEnrollmentLinkIssued = Omit<
  Schema<"OrganizationEnrollmentLinkIssuedDto">,
  "enrollmentLink" | "token"
> & {
  enrollmentLink: OrganizationEnrollmentLink;
  token: string;
};

export type OrganizationEnrollmentClaim = NonNullableFields<
  Schema<"OrganizationEnrollmentClaimDto">,
  "subjectId"
>;

export type OrganizationEnrollmentOutcome = Omit<
  Schema<"OrganizationEnrollmentOutcomeDto">,
  "claim" | "membership"
> & {
  claim: OrganizationEnrollmentClaim;
  membership: OrganizationMembershipSummary | null;
};

export type OrganizationJoinRequestListResponse = Omit<
  Schema<"OrganizationJoinRequestListResponse">,
  "items"
> & {
  items: OrganizationEnrollmentClaim[];
};

export type WorkspaceStaffOnboardingSourceKind = Schema<"WorkspaceStaffOnboardingSourceKind">;
export type WorkspaceStaffOnboardingStatus = Schema<"WorkspaceStaffOnboardingStatus">;

export type WorkspaceStaffOnboarding = NonNullableFields<
  Schema<"WorkspaceStaffOnboardingDto">,
  "subjectId"
>;

export type WorkspaceStaffOnboardingListResponse = Omit<
  Schema<"WorkspaceStaffOnboardingListResponse">,
  "items"
> & {
  items: WorkspaceStaffOnboarding[];
};

export type Property = NonNullableFields<
  Schema<"PropertyDto">,
  "name" | "code" | "timeZoneId" | "status"
>;

export type PropertyListResponse = Omit<Schema<"PropertyListResponse">, "properties"> & {
  properties: Property[];
};

export type Room = NonNullableFields<Schema<"RoomDto">, "name" | "status">;

export type RoomListResponse = Omit<Schema<"RoomListResponse">, "rooms"> & {
  rooms: Room[];
};

export type Bed = NonNullableFields<Schema<"BedDto">, "label" | "status">;

export type BedListResponse = Omit<Schema<"BedListResponse">, "beds"> & {
  beds: Bed[];
};

export type InventorySalesMode = Schema<"InventorySalesMode"> | "unconfigured" | "roomLevel" | "bedLevel";
export type InventoryUnitKind = Schema<"InventoryUnitKind"> | "room" | "bed";
export type InventoryBlockTargetKind = Schema<"InventoryBlockTargetKind">;
export type InventoryBlockTarget = Schema<"InventoryBlockTarget">;

export type InventoryUnit = Omit<
  NonNullableFields<Schema<"InventoryUnitDto">, "label">,
  "kind"
> & { kind: InventoryUnitKind };

export type RoomInventory = Omit<
  NonNullableFields<Schema<"RoomInventoryDto">, "roomName" | "units">,
  "salesMode" | "units"
> & {
  salesMode: InventorySalesMode;
  units: InventoryUnit[];
};

export type RoomInventoryListResponse = Omit<Schema<"RoomInventoryListResponse">, "rooms"> & {
  rooms: RoomInventory[];
};

export type RoomInventoryChangeImpact = Omit<
  Schema<"RoomInventoryChangeImpactDto">,
  "affectedReservationIds"
> & { affectedReservationIds: string[] };

export type BedRetirement = Omit<
  NonNullableFields<Schema<"BedRetirementDto">, "reason" | "requestedBy" | "affectedReservationIds">,
  "status"
> & {
  status: Schema<"InventoryRetirementStatus">;
};

export type RoomRetirement = Omit<
  NonNullableFields<Schema<"RoomRetirementDto">, "reason" | "requestedBy" | "affectedReservationIds">,
  "status"
> & {
  status: Schema<"InventoryRetirementStatus">;
};

export type TopologyRetirement = BedRetirement | RoomRetirement;

export type InventoryUnitAvailability = Omit<
  NonNullableFields<Schema<"InventoryUnitAvailabilityDto">, "activeBlockIds" | "activeAllocationIds">,
  "unit"
> & { unit: InventoryUnit };

export type InventoryAvailabilityResponse = Omit<Schema<"InventoryAvailabilityResponse">, "units"> & {
  units: InventoryUnitAvailability[];
};

export type ManualBlock = Omit<NonNullableFields<Schema<"ManualInventoryBlockDto">, "reason">, "status"> & {
  status: Schema<"ManualInventoryBlockStatus"> | "active" | "released";
};

export type ManualBlockListResponse = Omit<Schema<"ManualInventoryBlockListResponse">, "blocks"> & {
  blocks: ManualBlock[];
};

export type ManualBlockGroup = Omit<Schema<"ManualInventoryBlockGroupDto">, "blocks"> & {
  blocks: ManualBlock[];
};

export type ReservationStatus = Schema<"ReservationStatus">
  | "pendingAllocation"
  | "confirmed"
  | "allocationRejected"
  | "cancellationPending"
  | "cancelled"
  | "checkedIn"
  | "noShowPending"
  | "noShow"
  | "checkoutPending"
  | "checkedOut";

export type ReservationSourceKind = Schema<"ReservationSourceKind"> | "direct" | "external";
export type ReservationGuestRole = Schema<"ReservationGuestRoleKind"> | "primary";
export type ReservationDetailsChangeOrigin = Schema<"ReservationDetailsChangeOriginKind">
  | "staff"
  | "adapter"
  | "admin"
  | "system";

export type ReservationGuest = {
  guestId: string;
  role: ReservationGuestRole;
};

export type Reservation = Omit<
  NonNullableFields<Schema<"ReservationDto">, "inventoryUnitIds" | "primaryGuestName">,
  "status" | "sourceKind" | "guests"
> & {
  status: ReservationStatus;
  sourceKind: ReservationSourceKind;
  guests: ReservationGuest[];
};

export type ReservationListResponse = Omit<Schema<"ReservationListResponse">, "reservations"> & {
  reservations: Reservation[];
};

export type ReservationDetailsSnapshot = {
  arrival: string;
  departure: string;
  expectedArrivalTime?: string | null;
  expectedDepartureTime?: string | null;
  inventoryUnitIds: string[];
  primaryGuestName: string;
  email?: string | null;
  phone?: string | null;
  guestCount: number;
  notes?: string | null;
};

export type ReservationDetailsHistoryItem = {
  changeId: string;
  reservationId: string;
  propertyId: string;
  fromRevision: number;
  toRevision: number;
  origin: ReservationDetailsChangeOrigin;
  actorId?: string | null;
  adapterConnectionId?: string | null;
  externalOperationId?: string | null;
  correlationId: string;
  changedFields: string[];
  before?: ReservationDetailsSnapshot | null;
  after: ReservationDetailsSnapshot;
  occurredAtUtc: string;
};

export type GuestStatus = Schema<"GuestStatus"> | "active" | "archived";

export type GuestProfile = {
  guestId: string;
  originPropertyId: string;
  displayName: string;
  legalName?: string | null;
  email?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  nationalityCountryCode?: string | null;
  preferredLanguageTag?: string | null;
  notes?: string | null;
  status: GuestStatus;
  version: number;
  createdBy: string;
  createdAtUtc: string;
  lastChangedBy: string;
  lastChangedAtUtc: string;
  archivedAtUtc?: string | null;
};

export type GuestListResponse = {
  guests: GuestProfile[];
  page: number;
  pageSize: number;
};

export type GuestStayRole = 0 | 1 | "unknown" | "primary" | string;
export type GuestStayStatus = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | string;

export type GuestStayHistoryItem = {
  reservationId: string;
  propertyId: string;
  role: GuestStayRole;
  arrival: string;
  departure: string;
  status: GuestStayStatus;
  checkedInBusinessDate?: string | null;
  noShowBusinessDate?: string | null;
  checkedOutBusinessDate?: string | null;
  isCurrentParticipant: boolean;
  reservationVersion: number;
};

export type StaffStatus = Schema<"StaffStatus"> | "active" | "suspended" | "departed";

export type StaffPropertyAssignment = {
  assignmentId: string;
  propertyId: string;
  propertyJobTitle?: string | null;
  isPrimary: boolean;
  isCurrent: boolean;
  effectiveFrom: string;
  effectiveTo?: string | null;
  assignedAtUtc: string;
  unassignedAtUtc?: string | null;
  assignedAtVersion: number;
  unassignedAtVersion?: number | null;
};

export type StaffMember = {
  staffMemberId: string;
  displayName: string;
  legalName?: string | null;
  workEmail?: string | null;
  workPhone?: string | null;
  employeeNumber?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  authSubjectId?: string | null;
  status: StaffStatus;
  version: number;
  createdAtUtc: string;
  lastChangedAtUtc: string;
  suspendedAtUtc?: string | null;
  departedAtUtc?: string | null;
  assignments: StaffPropertyAssignment[];
};

export type StaffListResponse = {
  items: StaffMember[];
  page: number;
  pageSize: number;
};

export type AdapterExecutionMode = Schema<"AdapterExecutionMode"> | "polling" | "continuous" | "push" | "remotePolling";
export type AdapterConflictPolicy = Schema<"AdapterConflictPolicy"> | "suggestionsOnly" | "autoApplyWhenAdapterBaselineUnchanged";
export type AdapterConnectionStatus = Schema<"AdapterConnectionStatus"> | "enabled" | "disabled";

export type AdapterConnection = {
  connectionId: string;
  propertyId: string;
  adapterType: string;
  executionMode: AdapterExecutionMode;
  pollingIntervalSeconds?: number | null;
  pollingScheduleMaxAttempts?: number | null;
  pollingScheduleConfiguredAtUtc?: string | null;
  conflictPolicy: AdapterConflictPolicy;
  configurationReference: string;
  hasSecretReference: boolean;
  checkpoint?: string | null;
  status: AdapterConnectionStatus;
  version: number;
  createdAtUtc: string;
  updatedAtUtc?: string | null;
};

export type AdapterConnectionListResponse = { connections: AdapterConnection[]; page: number; pageSize: number; totalCount: number };

export type AdapterTypeCapability = {
  adapterType: string;
  protocolVersion: number;
  configurationSchemaVersion: number;
  executionModes: AdapterExecutionMode[];
  minimumPollingIntervalSeconds?: number | null;
  recommendedPollingIntervalSeconds?: number | null;
};
export type AdapterTypeCapabilityListResponse = { adapterTypes: AdapterTypeCapability[] };

export type AdapterConnectionHealth = {
  connectionId: string;
  propertyId: string;
  adapterType: string;
  connectionStatus: AdapterConnectionStatus;
  executionMode: AdapterExecutionMode;
  capabilityStatus: number | string;
  protocolVersion?: number | null;
  configurationSchemaVersion?: number | null;
  pollingIntervalSeconds?: number | null;
  pollingScheduleMaxAttempts?: number | null;
  pollingScheduleConfiguredAtUtc?: string | null;
  nextRunExpectedAtUtc?: string | null;
  runExpected: boolean;
  operationalState: number | string;
  latestRunId?: string | null;
  latestRunStatus?: number | string | null;
  latestRunStartedAtUtc?: string | null;
  latestRunCompletedAtUtc?: string | null;
  latestRunError?: string | null;
  lastSuccessfulRunAtUtc?: string | null;
  lastObservationReceivedAtUtc?: string | null;
  pendingReceiptCount: number;
  rejectedReceiptCount: number;
  expiredRawPayloadCount: number;
  protectedRawPayloadCount: number;
  heldExpiredRawPayloadCount: number;
  purgingRawPayloadCount: number;
  dueSensitiveHistoryCount: number;
  heldDueSensitiveHistoryCount: number;
  redactedSensitiveHistoryCount: number;
  activeLegalHoldCount: number;
  evaluatedAtUtc: string;
};

export type AdapterIngressCredential = {
  credentialId: string;
  connectionId: string;
  slot: number;
  label: string;
  status: number | string;
  expiresAtUtc: string;
  createdBy: string;
  createdAtUtc: string;
  revokedBy?: string | null;
  revokedAtUtc?: string | null;
  lastAuthenticatedAtUtc?: string | null;
  version: number;
};
export type AdapterIngressCredentialListResponse = { credentials: AdapterIngressCredential[]; page: number; pageSize: number; totalCount: number };
export type CreateAdapterIngressCredentialResponse = { credential: AdapterIngressCredential; token: string };

export type ChangeProposalStatus = Schema<"ChangeProposalStatus"> | "pending" | "applying" | "applied" | "rejected" | "superseded" | "stale" | "failed";
export type ChangeProposalSummary = {
  proposalId: string;
  propertyId: string;
  connectionId: string;
  receiptId: string;
  reservationId: string;
  baseReservationDetailsRevision: number;
  reasonCode: string;
  sensitiveHistoryStatus: number | string;
  sensitiveDataRetainUntilUtc?: string | null;
  sensitiveDataRedactedAtUtc?: string | null;
  status: ChangeProposalStatus;
  decisionActor?: string | null;
  decisionReason?: string | null;
  productOperationId?: string | null;
  version: number;
  createdAtUtc: string;
  decidedAtUtc?: string | null;
  completedAtUtc?: string | null;
};
export type ChangeProposal = ChangeProposalSummary & { diff?: string | null };
export type ChangeProposalListResponse = { proposals: ChangeProposalSummary[]; page: number; pageSize: number; totalCount: number };

export type IngestionRunStatus = Schema<"IngestionRunStatus"> | "running" | "succeeded" | "partiallySucceeded" | "failed" | "cancelled";
export type IngestionRun = {
  runId: string;
  connectionId: string;
  propertyId: string;
  executionKind: number | string;
  taskRunId?: string | null;
  taskAttempt?: number | null;
  remoteLeaseId?: string | null;
  remoteClaimId?: string | null;
  remoteLeaseEpoch?: number | null;
  remoteWorkerId?: string | null;
  remoteLeaseExpiresAtUtc?: string | null;
  startingCheckpoint?: string | null;
  acceptedCheckpoint?: string | null;
  status: IngestionRunStatus;
  observedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  errorMessage?: string | null;
  version: number;
  startedAtUtc: string;
  completedAtUtc?: string | null;
};
export type IngestionRunListResponse = { runs: IngestionRun[]; page: number; pageSize: number; totalCount: number };

export type ObservationReceiptStatus = Schema<"ObservationReceiptStatus"> | "pending" | "processed" | "rejected";
export type ObservationReceipt = {
  receiptId: string;
  propertyId: string;
  connectionId: string;
  runId?: string | null;
  operationId: string;
  sourceRecordType: string;
  externalId: string;
  sourceRevision?: string | null;
  contentHash: string;
  rawPayloadFileId: string;
  rawPayloadStatus: number | string;
  rawPayloadRetainUntilUtc: string;
  rawPayloadPurgedAtUtc?: string | null;
  activeReprocessingAttemptId?: string | null;
  reprocessingReservationExpiresAtUtc?: string | null;
  sourceReceiptId?: string | null;
  reprocessingAttemptId?: string | null;
  parserType?: string | null;
  parserVersion?: number | null;
  parserOutputIndex?: number | null;
  sourceUpdatedAtUtc?: string | null;
  observedAtUtc: string;
  status: ObservationReceiptStatus;
  rejectionReason?: string | null;
  receivedAtUtc: string;
  processedAtUtc?: string | null;
};
export type ObservationReceiptListResponse = { receipts: ObservationReceipt[]; page: number; pageSize: number; totalCount: number };

export type ObservationParserCapability = { parserType: string; parserVersion: number; supportedAdapterTypes: string[]; supportedSourceRecordTypes: string[]; outputRecordTypes: string[] };
export type ObservationParserCapabilityListResponse = { parsers: ObservationParserCapability[] };

export type ObservationReprocessingStatus = Schema<"ObservationReprocessingStatus"> | "queued" | "running" | "succeeded" | "noMatch" | "failed" | "canceled" | "expired";
export type ObservationReprocessingAttempt = {
  attemptId: string;
  propertyId: string;
  connectionId: string;
  sourceReceiptId: string;
  taskRunId: string;
  parserType: string;
  parserVersion: number;
  requestedBy: string;
  status: ObservationReprocessingStatus;
  lastTaskAttempt: number;
  parsedCount: number;
  acceptedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  lastErrorCode?: string | null;
  requestedAtUtc: string;
  startedAtUtc?: string | null;
  completedAtUtc?: string | null;
  reservationExpiresAtUtc: string;
  version: number;
};
export type ObservationReprocessingOutput = { outputIndex: number; operationId: string; receiptId?: string | null; status: number | string; recordType: string; externalId: string; sourceRevision?: string | null; contentHash: string; errorCode?: string | null; recordedAtUtc: string };
export type ObservationReprocessingAttemptDetails = { attempt: ObservationReprocessingAttempt; outputs: ObservationReprocessingOutput[] };
export type ObservationReprocessingAttemptListResponse = { attempts: ObservationReprocessingAttempt[]; page: number; pageSize: number; totalCount: number };

export type NotificationSeverity = 0 | 1 | 2 | 3 | 4 | "info" | "success" | "warning" | "error" | string;
export type NotificationHistoryItem = {
  id: string;
  module: string;
  name: string;
  version: number;
  title: string;
  body?: string | null;
  severity: NotificationSeverity;
  streamSequence: number;
  occurredAtUtc: string;
  createdAtUtc: string;
  readAtUtc?: string | null;
  payload: unknown;
};
export type NotificationHistoryListResponse = { items: NotificationHistoryItem[]; page: number; pageSize: number; totalCount: number; unreadCount: number };
export type NotificationBroadcastItem = {
  broadcastId: string;
  scopeId?: string | null;
  audience: number | string;
  module: string;
  name: string;
  version: number;
  title: string;
  body?: string | null;
  severity: NotificationSeverity;
  streamSequence: number;
  occurredAtUtc: string;
  createdAtUtc: string;
  readAtUtc?: string | null;
  payload: unknown;
};
export type NotificationBroadcastListResponse = { items: NotificationBroadcastItem[]; page: number; pageSize: number; totalCount: number; unreadCount: number };
export type MarkAllNotificationsReadResponse = { updatedCount: number };

export type BrowserAuthResponse = NonNullableFields<Schema<"BrowserAuthResponse">, "accessToken">;

export type AuthSelfRegistration = Schema<"AuthSelfRegistrationResponse">;

export type AuthenticationEmail = NonNullableFields<
  Schema<"AuthenticationEmailResponse">,
  "email"
>;

export type ExternalIdentity = NonNullableFields<
  Schema<"ExternalIdentityResponse">,
  "providerCode"
>;

export type AuthenticationMethods = Omit<
  Schema<"AuthenticationMethodsResponse">,
  "emails" | "externalIdentities"
> & {
  emails: AuthenticationEmail[];
  externalIdentities: ExternalIdentity[];
};

export type AuthenticationSession = NonNullableFields<
  Schema<"AuthenticationSessionResponse">,
  "authenticationMethod"
>;

export type AuthenticationSessions = Omit<
  Schema<"AuthenticationSessionsResponse">,
  "sessions"
> & {
  sessions: AuthenticationSession[];
};

export type ExternalAuthenticationProviderList = {
  providers: string[];
};

export type ExternalAuthenticationChallenge = NonNullableFields<
  Schema<"ExternalAuthenticationChallengeResponse">,
  "startUrl"
>;

export type ExternalAuthenticationStatus = Schema<"ExternalAuthenticationStatus"> | "authenticated" | "linked";

export type ExternalAuthenticationResult = Omit<
  Schema<"ExternalAuthenticationResponse">,
  "status" | "providerCode"
> & {
  status: ExternalAuthenticationStatus;
  providerCode: string;
};

export type AccessPermissionCheck = NonNullableFields<Schema<"AccessPermissionCheck">, "permission" | "scope">;
export type AccessPermissionDecision = NonNullableFields<Schema<"AccessPermissionDecision">, "permission" | "scope">;
export type AccessPermissionEvaluationResponse = Omit<
  Schema<"AccessPermissionEvaluationResponse">,
  "permissions"
> & { permissions: AccessPermissionDecision[] };

export type SmokeStatus = {
  application: string;
  service: string;
  status: string;
  timestampUtc: string;
};
