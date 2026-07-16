import { ChevronLeft, ChevronRight } from "lucide-react";

type PaginationBarProps = {
  page: number;
  pageSize: number;
  itemCount: number;
  itemLabel: string;
  onPageChange: (page: number) => void;
  totalCount?: number;
  disabled?: boolean;
};

export function PaginationBar({
  page,
  pageSize,
  itemCount,
  itemLabel,
  onPageChange,
  totalCount,
  disabled = false,
}: PaginationBarProps) {
  const totalPages = totalCount === undefined
    ? undefined
    : Math.max(1, Math.ceil(totalCount / pageSize));
  const hasNext = totalPages === undefined
    ? itemCount === pageSize
    : page < totalPages;

  if (page === 1 && !hasNext) return null;

  const countLabel = totalCount === undefined
    ? `${itemCount} ${pluralize(itemLabel, itemCount)}`
    : `${totalCount} ${pluralize(itemLabel, totalCount)}`;
  const pageLabel = totalPages === undefined
    ? `page ${page}`
    : `page ${page} of ${totalPages}`;

  return (
    <div className="flex min-h-14 items-center justify-between gap-4 border-t border-base-300 px-4 py-3 sm:px-6">
      <p className="text-xs font-medium text-base-content/45">{countLabel} · {pageLabel}</p>
      <div className="join shrink-0">
        <button
          type="button"
          className="btn btn-sm join-item"
          disabled={disabled || page === 1}
          onClick={() => onPageChange(page - 1)}
          aria-label={`Previous ${itemLabel} page`}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          className="btn btn-sm join-item"
          disabled={disabled || !hasNext}
          onClick={() => onPageChange(page + 1)}
          aria-label={`Next ${itemLabel} page`}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

function pluralize(label: string, count: number) {
  return count === 1 ? label : `${label}s`;
}
