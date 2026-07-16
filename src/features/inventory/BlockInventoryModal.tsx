import type { UseMutationResult } from "@tanstack/react-query";
import {
  BedDouble,
  Building2,
  DoorOpen,
  Layers3,
  MapPinned,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { InventoryBlockTarget, RoomInventory } from "../../api/types";
import { ErrorState, FormActions, Modal } from "../../components/ui/primitives";
import { DatePicker } from "../../components/ui/DatePicker";
import {
  buildBlockTargetOptions,
  type BlockTargetKind,
  type BlockTargetOption,
} from "./inventoryBlocking";

export type CreateBlockGroupPayload = {
  target: InventoryBlockTarget;
  arrival: string;
  departure: string;
  reason: string;
};

type BlockInventoryModalProps = {
  open: boolean;
  propertyName: string;
  rooms: RoomInventory[];
  mutation: UseMutationResult<unknown, Error, CreateBlockGroupPayload>;
  onClose: () => void;
};

const targetKinds: Array<{
  kind: BlockTargetKind;
  label: string;
  icon: typeof DoorOpen;
}> = [
  { kind: "property", label: "Property", icon: MapPinned },
  { kind: "building", label: "Building", icon: Building2 },
  { kind: "floor", label: "Floor", icon: Layers3 },
  { kind: "room", label: "Room", icon: DoorOpen },
  { kind: "unit", label: "Bed / unit", icon: BedDouble },
];

export function BlockInventoryModal({
  open,
  propertyName,
  rooms,
  mutation,
  onClose,
}: BlockInventoryModalProps) {
  const options = useMemo(
    () => buildBlockTargetOptions(propertyName, rooms),
    [propertyName, rooms],
  );
  const availableKinds = useMemo(
    () => targetKinds.filter(({ kind }) => options.some((option) => option.kind === kind)),
    [options],
  );
  const [targetKind, setTargetKind] = useState<BlockTargetKind>("room");
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [arrival, setArrival] = useState(() => defaultRange().arrival);
  const [departure, setDeparture] = useState(() => defaultRange().departure);
  const resetMutation = mutation.reset;

  useEffect(() => {
    if (!open) return;
    setTargetKind(availableKinds.some(({ kind }) => kind === "room") ? "room" : availableKinds[0]?.kind ?? "property");
    setSelectedId("");
    setSearch("");
    const range = defaultRange();
    setArrival(range.arrival);
    setDeparture(range.departure);
    resetMutation();
  }, [availableKinds, open, resetMutation]);

  const kindOptions = options.filter((option) => option.kind === targetKind);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleOptions = normalizedSearch
    ? kindOptions.filter((option) => option.searchText.includes(normalizedSearch))
    : kindOptions;
  const selectedOption = targetKind === "property"
    ? kindOptions[0]
    : kindOptions.find((option) => option.id === selectedId);

  function chooseKind(kind: BlockTargetKind) {
    setTargetKind(kind);
    setSelectedId("");
    setSearch("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOption) return;
    const data = new FormData(event.currentTarget);
    mutation.mutate({
      target: selectedOption.target,
      arrival,
      departure,
      reason: String(data.get("reason")),
    });
  }

  return (
    <Modal
      open={open}
      title="Block inventory"
      description="Choose the physical scope that operations need to take out of service."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold">Scope</legend>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-base-200 p-1 sm:grid-cols-5" aria-label="Inventory block scope">
            {availableKinds.map(({ kind, label, icon: Icon }) => (
              <button
                key={kind}
                type="button"
                className={`btn btn-sm w-full rounded-md border-0 ${targetKind === kind ? "bg-base-100 shadow-sm" : "btn-ghost"}`}
                aria-pressed={targetKind === kind}
                onClick={() => chooseKind(kind)}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        {targetKind !== "property" && (
          <label className="input input-bordered flex items-center gap-2">
            <Search size={17} className="text-base-content/40" />
            <input
              type="search"
              className="grow"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Search ${targetLabel(targetKind).toLocaleLowerCase()}`}
              aria-label={`Search ${targetLabel(targetKind).toLocaleLowerCase()}`}
            />
          </label>
        )}

        <div className="max-h-64 overflow-y-auto rounded-lg border border-base-300" role="radiogroup" aria-label={`${targetLabel(targetKind)} target`}>
          {visibleOptions.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-base-content/50">No matching inventory</p>
          ) : visibleOptions.map((option) => (
            <BlockTargetRow
              key={option.id}
              option={option}
              selected={selectedOption?.id === option.id}
              onSelect={() => setSelectedId(option.id)}
            />
          ))}
        </div>

        {selectedOption && (
          <div className="flex items-center justify-between gap-4 rounded-lg bg-primary/8 px-4 py-3 text-sm">
            <div className="min-w-0">
              <p className="truncate font-semibold">{selectedOption.label}</p>
              <p className="mt-0.5 text-xs text-base-content/55">{selectedOption.detail}</p>
            </div>
            <span className="badge badge-primary badge-outline shrink-0">
              {selectedOption.unitIds.length} {selectedOption.unitIds.length === 1 ? "unit" : "units"}
            </span>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <DateInput label="From" value={arrival} onChange={setArrival} />
          <DateInput label="Until" value={departure} min={arrival} onChange={setDeparture} />
        </div>

        <label className="form-control block">
          <span className="label-text mb-1.5 block text-sm font-semibold">Reason</span>
          <textarea
            className="textarea textarea-bordered min-h-20 w-full"
            name="reason"
            placeholder="Maintenance, private use, deep clean..."
            required
          />
        </label>

        {mutation.error && <ErrorState error={mutation.error} />}
        <FormActions
          submitting={mutation.isPending}
          disabled={!selectedOption}
          submitLabel={selectedOption && selectedOption.unitIds.length > 1 ? `Block ${selectedOption.unitIds.length} units` : "Block inventory"}
          onCancel={onClose}
        />
      </form>
    </Modal>
  );
}

function BlockTargetRow({
  option,
  selected,
  onSelect,
}: {
  option: BlockTargetOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <label className={`flex cursor-pointer items-center gap-3 border-b border-base-300 px-4 py-3 last:border-b-0 hover:bg-base-200/60 ${selected ? "bg-primary/8" : ""}`}>
      <input
        type="radio"
        className="radio radio-primary radio-sm"
        name="blockTarget"
        value={option.id}
        checked={selected}
        onChange={onSelect}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{option.label}</span>
        <span className="mt-0.5 block truncate text-xs text-base-content/50">{option.detail}</span>
      </span>
      <span className="text-xs tabular-nums text-base-content/45">{option.unitIds.length}</span>
    </label>
  );
}

function DateInput({ label, value, min, onChange }: { label: string; value: string; min?: string; onChange: (value: string) => void }) {
  return (
    <div className="form-control block">
      <span className="label-text mb-1.5 block text-sm font-semibold">{label}</span>
      <DatePicker className="w-full" value={value} min={min} onChange={onChange} ariaLabel={label} required />
    </div>
  );
}

function targetLabel(kind: BlockTargetKind): string {
  return ({
    property: "Property",
    building: "Building",
    floor: "Floor",
    room: "Room",
    unit: "Bed or unit",
  } as const)[kind];
}

function defaultRange() {
  const arrival = new Date();
  arrival.setDate(arrival.getDate() + 1);
  const departure = new Date(arrival);
  departure.setDate(departure.getDate() + 2);
  return {
    arrival: arrival.toISOString().slice(0, 10),
    departure: departure.toISOString().slice(0, 10),
  };
}
