import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Globe2, Pause, RotateCcw, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type {
  CountryPolicy,
  CountryPolicyListResponse,
  Property,
  PropertyGovernancePolicyBinding,
  PropertyProcessingState,
} from "../../api/types";
import { useSession } from "../../app/session";
import {
  ErrorState,
  FormActions,
  LoadingState,
  Modal,
  StatusBadge,
} from "../../components/ui/primitives";
import { SelectPicker } from "../../components/ui/SelectPicker";
import {
  availableCountryPolicies,
  buildPropertyProcessingActivation,
  choosePolicyCoordinate,
  chooseRetentionPolicy,
  countryPolicyKey,
  matchingBoundPolicy,
  propertyProcessingMessage,
  type PropertyProcessingActivationInput,
} from "./propertyProcessing";

type PropertyProcessingPanelProps = {
  property: Property;
  canManage: boolean;
  onChanged: () => Promise<void> | void;
};

export function PropertyProcessingPanel({ property, canManage, onChanged }: PropertyProcessingPanelProps) {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const [activationOpen, setActivationOpen] = useState(false);
  const [suspensionOpen, setSuspensionOpen] = useState(false);
  const processing = useQuery({
    queryKey: ["property-processing", property.propertyId],
    queryFn: () => request<PropertyProcessingState>(`/api/properties/${property.propertyId}/processing`),
  });
  const policies = useQuery({
    queryKey: ["country-policies", property.propertyId],
    queryFn: () => request<CountryPolicyListResponse>(`/api/properties/${property.propertyId}/country-policies`),
    enabled: canManage,
    staleTime: 60_000,
  });

  async function refreshProperty() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["property-processing", property.propertyId] }),
      onChanged(),
    ]);
  }

  const activation = useMutation({
    mutationFn: (input: PropertyProcessingActivationInput) => request<Property>(
      `/api/properties/${property.propertyId}/processing/activate`,
      { method: "POST", body: JSON.stringify(input) },
    ),
    onSuccess: async () => {
      setActivationOpen(false);
      await refreshProperty();
    },
  });
  const suspension = useMutation({
    mutationFn: (expectedVersion: number) => request<void>(
      `/api/properties/${property.propertyId}/processing/suspend`,
      { method: "POST", body: JSON.stringify({ confirmed: true, expectedVersion }) },
    ),
    onSuccess: async () => {
      setSuspensionOpen(false);
      await refreshProperty();
    },
  });

  if (processing.isLoading) {
    return <div className="card border border-base-300 bg-base-100 shadow-sm"><LoadingState label="Checking data processing" /></div>;
  }
  if (processing.error || !processing.data) {
    return <div className="card border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6"><ErrorState error={processing.error} retry={() => void processing.refetch()} title="Couldn't check data processing" /></div>;
  }

  const state = processing.data;
  const binding = state.governancePolicy;
  const selectablePolicies = availableCountryPolicies(policies.data?.items ?? []);
  const canSuspend = canManage && state.configuredStatus === "enabled";
  const needsAttention = state.effectiveStatus === "expired" || state.effectiveStatus === "revoked";

  return (
    <>
      <section className={`card border bg-base-100 shadow-sm ${needsAttention ? "border-warning/45" : "border-base-300"}`}>
        <div className="card-body gap-5 p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 gap-3">
              <div className={`grid size-10 shrink-0 place-items-center rounded-lg ${needsAttention ? "bg-warning/15 text-warning-content" : state.effectiveStatus === "enabled" ? "bg-success/15 text-success" : "bg-base-200 text-base-content/55"}`}>
                {needsAttention ? <ShieldAlert size={19} /> : state.effectiveStatus === "enabled" ? <ShieldCheck size={19} /> : <Globe2 size={19} />}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-xl font-semibold">Data processing</h2>
                  <StatusBadge status={state.effectiveStatus} />
                </div>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-base-content/60">
                  {propertyProcessingMessage(state.effectiveStatus)}
                </p>
              </div>
            </div>
            {canManage && (
              <div className="flex shrink-0 flex-wrap gap-2">
                {canSuspend && (
                  <button className="btn btn-sm btn-ghost" onClick={() => setSuspensionOpen(true)}>
                    <Pause size={15} />Suspend
                  </button>
                )}
                <button
                  className="btn btn-sm btn-primary"
                  disabled={policies.isLoading || selectablePolicies.length === 0}
                  onClick={() => setActivationOpen(true)}
                >
                  <RotateCcw size={15} />
                  {binding ? "Change policy" : "Configure"}
                </button>
              </div>
            )}
          </div>

          {binding && <PolicyBindingDetails binding={binding} />}

          {canManage && policies.error && (
            <ErrorState error={policies.error} retry={() => void policies.refetch()} title="Couldn't load configured policies" />
          )}
          {canManage && !policies.isLoading && !policies.error && selectablePolicies.length === 0 && (
            <div className="alert border border-base-300 bg-base-200/65 text-base-content">
              <Database size={18} className="text-base-content/50" />
              <div>
                <p className="font-semibold">No usable country policy is configured</p>
                <p className="text-sm text-base-content/60">This property remains blocked until the deployment administrator installs and allowlists a current policy pack.</p>
              </div>
            </div>
          )}
        </div>
      </section>

      <PolicyActivationModal
        open={activationOpen}
        property={property}
        processing={state}
        policies={selectablePolicies}
        pending={activation.isPending}
        error={activation.error}
        onClose={() => {
          activation.reset();
          setActivationOpen(false);
        }}
        onSubmit={(input) => activation.mutate(input)}
      />
      <SuspendProcessingModal
        open={suspensionOpen}
        state={state}
        pending={suspension.isPending}
        error={suspension.error}
        onClose={() => {
          suspension.reset();
          setSuspensionOpen(false);
        }}
        onConfirm={() => suspension.mutate(state.propertyVersion)}
      />
    </>
  );
}

function PolicyBindingDetails({ binding }: { binding: PropertyGovernancePolicyBinding }) {
  return (
    <dl className="grid gap-x-6 gap-y-4 border-t border-base-300 pt-5 text-sm sm:grid-cols-2 xl:grid-cols-4">
      <PolicyCoordinate label="Operating country" value={countryLabel(binding.operatingCountryCode)} />
      <PolicyCoordinate label="Policy" value={`${binding.policyId} v${binding.policyVersion}`} />
      <PolicyCoordinate label="Data region" value={binding.dataRegionId} />
      <PolicyCoordinate label="Transfer profile" value={binding.transferProfileId} />
      <PolicyCoordinate label="Retention policy" value={`${binding.retentionPolicyId} v${binding.retentionPolicyVersion}`} />
      <PolicyCoordinate label="Activated" value={formatDate(binding.activatedAtUtc)} />
      <PolicyCoordinate label="Effective" value={formatDate(binding.policyEffectiveAtUtc)} />
      <PolicyCoordinate label="Expires" value={formatDate(binding.policyExpiresAtUtc)} />
    </dl>
  );
}

function PolicyCoordinate({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs font-semibold uppercase tracking-[0.12em] text-base-content/40">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>;
}

function PolicyActivationModal({ open, property, processing, policies, pending, error, onClose, onSubmit }: {
  open: boolean;
  property: Property;
  processing: PropertyProcessingState;
  policies: CountryPolicy[];
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (input: PropertyProcessingActivationInput) => void;
}) {
  const boundPolicy = matchingBoundPolicy(policies, processing.governancePolicy);
  const initialPolicy = boundPolicy ?? policies[0];
  const [policyKey, setPolicyKey] = useState(initialPolicy ? countryPolicyKey(initialPolicy) : "");
  const [dataRegionId, setDataRegionId] = useState("");
  const [transferProfileId, setTransferProfileId] = useState("");
  const [retentionKey, setRetentionKey] = useState("");
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState(false);
  const selectedPolicy = policies.find((policy) => countryPolicyKey(policy) === policyKey) ?? initialPolicy;
  const selectedRetention = selectedPolicy?.retentionPolicies.find((policy) => retentionKey === retentionPolicyKey(policy))
    ?? chooseRetentionPolicy(selectedPolicy?.retentionPolicies ?? [], processing.governancePolicy);

  useEffect(() => {
    if (!open || !initialPolicy) return;
    const sameBinding = processing.governancePolicy && countryPolicyKey(initialPolicy) === countryPolicyKey({
      policyId: processing.governancePolicy.policyId,
      policyVersion: processing.governancePolicy.policyVersion,
      contentSha256: processing.governancePolicy.contentSha256,
    });
    setPolicyKey(countryPolicyKey(initialPolicy));
    setDataRegionId(choosePolicyCoordinate(
      initialPolicy.permittedDataRegions,
      sameBinding ? processing.governancePolicy?.dataRegionId : null,
    ));
    setTransferProfileId(choosePolicyCoordinate(
      initialPolicy.permittedTransferProfiles,
      sameBinding ? processing.governancePolicy?.transferProfileId : null,
    ));
    const retention = chooseRetentionPolicy(
      initialPolicy.retentionPolicies,
      sameBinding ? processing.governancePolicy : null,
    );
    setRetentionKey(retention ? retentionPolicyKey(retention) : "");
    setAccepted(new Set());
    setConfirmed(false);
  }, [initialPolicy, open, processing.governancePolicy]);

  function changePolicy(nextKey: string) {
    const nextPolicy = policies.find((policy) => countryPolicyKey(policy) === nextKey);
    if (!nextPolicy) return;
    setPolicyKey(nextKey);
    setDataRegionId(nextPolicy.permittedDataRegions[0] ?? "");
    setTransferProfileId(nextPolicy.permittedTransferProfiles[0] ?? "");
    setRetentionKey(nextPolicy.retentionPolicies[0] ? retentionPolicyKey(nextPolicy.retentionPolicies[0]) : "");
    setAccepted(new Set());
    setConfirmed(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPolicy || !selectedRetention || !confirmed || accepted.size !== selectedPolicy.requiredAcknowledgements.length) return;
    onSubmit(buildPropertyProcessingActivation(
      selectedPolicy,
      dataRegionId,
      transferProfileId,
      selectedRetention,
      processing.propertyVersion,
    ));
  }

  const acknowledgementsComplete = Boolean(selectedPolicy) && accepted.size === selectedPolicy.requiredAcknowledgements.length;
  const canSubmit = Boolean(selectedPolicy && selectedRetention && dataRegionId && transferProfileId && confirmed && acknowledgementsComplete);

  return (
    <Modal open={open} title={processing.governancePolicy ? "Change country policy" : "Configure data processing"} description={`Choose the deployment policy coordinates for ${property.name}.`} onClose={onClose} size="lg">
      {!selectedPolicy ? <div className="py-8"><LoadingState label="No usable policy available" /></div> : (
        <form onSubmit={submit} className="space-y-5">
          <PickerField label="Country policy">
            <SelectPicker
              className="w-full"
              value={countryPolicyKey(selectedPolicy)}
              onValueChange={changePolicy}
              ariaLabel="Country policy"
              options={policies.map((policy) => ({
                value: countryPolicyKey(policy),
                label: `${countryLabel(policy.operatingCountryCode)} · ${policy.policyId} v${policy.policyVersion}`,
                description: `Effective ${formatDate(policy.effectiveAtUtc)} to ${formatDate(policy.expiresAtUtc)}`,
              }))}
            />
          </PickerField>

          <div className="grid gap-4 sm:grid-cols-2">
            <PickerField label="Data region">
              <SelectPicker className="w-full" value={dataRegionId} onValueChange={setDataRegionId} ariaLabel="Data region" options={selectedPolicy.permittedDataRegions.map((value) => ({ value, label: value }))} />
            </PickerField>
            <PickerField label="Transfer profile">
              <SelectPicker className="w-full" value={transferProfileId} onValueChange={setTransferProfileId} ariaLabel="Transfer profile" options={selectedPolicy.permittedTransferProfiles.map((value) => ({ value, label: value }))} />
            </PickerField>
          </div>

          <PickerField label="Retention policy">
            <SelectPicker className="w-full" value={selectedRetention ? retentionPolicyKey(selectedRetention) : ""} onValueChange={setRetentionKey} ariaLabel="Retention policy" options={selectedPolicy.retentionPolicies.map((policy) => ({ value: retentionPolicyKey(policy), label: `${policy.retentionPolicyId} v${policy.retentionPolicyVersion}` }))} />
          </PickerField>

          {selectedPolicy.requiredAcknowledgements.length > 0 && (
            <fieldset className="space-y-2 border-t border-base-300 pt-4">
              <legend className="mb-2 text-sm font-semibold">Required acknowledgements</legend>
              {selectedPolicy.requiredAcknowledgements.map((acknowledgement) => {
                const key = acknowledgementKey(acknowledgement.acknowledgementId, acknowledgement.acknowledgementVersion);
                return (
                  <label key={key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-base-300 p-3 hover:border-primary/35">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-primary checkbox-sm mt-0.5"
                      checked={accepted.has(key)}
                      onChange={(event) => setAccepted((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(key); else next.delete(key);
                        return next;
                      })}
                    />
                    <span className="text-sm"><span className="font-semibold">{acknowledgement.acknowledgementId}</span> <span className="text-base-content/50">version {acknowledgement.acknowledgementVersion}</span></span>
                  </label>
                );
              })}
            </fieldset>
          )}

          <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-base-200 p-4">
            <input type="checkbox" className="checkbox checkbox-primary checkbox-sm mt-0.5" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span className="text-sm leading-5">I confirm that this property operates in {countryLabel(selectedPolicy.operatingCountryCode)} and that these deployment policy coordinates are correct.</span>
          </label>

          {error != null && <ErrorState error={error} title="Couldn't enable data processing" />}
          <FormActions submitting={pending} disabled={!canSubmit} submitLabel={processing.configuredStatus === "suspended" ? "Resume processing" : processing.governancePolicy ? "Apply policy" : "Enable processing"} onCancel={onClose} />
        </form>
      )}
    </Modal>
  );
}

function SuspendProcessingModal({ open, state, pending, error, onClose, onConfirm }: {
  open: boolean;
  state: PropertyProcessingState;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    if (open) setConfirmed(false);
  }, [open]);

  return (
    <Modal open={open} title="Suspend data processing" description="Pause new guest, reservation and adapter writes for this property." onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); if (confirmed) onConfirm(); }} className="space-y-4">
        <div className="alert border border-warning/25 bg-warning/10 text-base-content">
          <ShieldAlert size={19} className="text-warning-content" />
          <p className="text-sm leading-5">Existing records are retained for authorized operations and cleanup. Resume requires a currently accepted country policy.</p>
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-base-200 p-4">
          <input type="checkbox" className="checkbox checkbox-primary checkbox-sm mt-0.5" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span className="text-sm leading-5">I understand that new property-scoped personal-data processing will be blocked.</span>
        </label>
        {error != null && <ErrorState error={error} title="Couldn't suspend data processing" />}
        <FormActions submitting={pending} disabled={!confirmed || state.configuredStatus !== "enabled"} submitLabel="Suspend processing" onCancel={onClose} />
      </form>
    </Modal>
  );
}

function PickerField({ label, children }: { label: string; children: ReactNode }) {
  return <div className="form-control block"><span className="label-text mb-1.5 block text-sm font-semibold">{label}</span>{children}</div>;
}

function retentionPolicyKey(policy: { retentionPolicyId: string; retentionPolicyVersion: number }): string {
  return `${policy.retentionPolicyId}:${policy.retentionPolicyVersion}`;
}

function acknowledgementKey(id: string, version: number): string {
  return `${id}:${version}`;
}

function countryLabel(code: string): string {
  try {
    return `${new Intl.DisplayNames([navigator.language], { type: "region" }).of(code) ?? code} (${code})`;
  } catch {
    return code;
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}
