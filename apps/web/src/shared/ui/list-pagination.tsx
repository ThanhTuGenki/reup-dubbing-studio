import { useId } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Pagination, PaginationContent, PaginationItem } from '@/components/ui/pagination';
import { PAGE_SIZE_OPTIONS, type PageSize } from '../lib/list-query';

interface ListPaginationValue {
  page: number;
  pageSize: PageSize;
}

interface ListPaginationProps extends ListPaginationValue {
  totalItems: number;
  itemLabel: string;
  onChange: (value: ListPaginationValue) => void;
}

const numberFormatter = new Intl.NumberFormat('vi-VN');

export function ListPagination({
  page,
  pageSize,
  totalItems,
  itemLabel,
  onChange,
}: ListPaginationProps) {
  const pageSizeId = useId();
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const firstItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastItem = Math.min(currentPage * pageSize, totalItems);

  return (
    <Pagination
      aria-label={`Phân trang ${itemLabel}`}
      className="flex-col items-start justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center"
    >
      <span aria-live="polite">
        Hiển thị {numberFormatter.format(firstItem)}–{numberFormatter.format(lastItem)} trong{' '}
        {numberFormatter.format(totalItems)} {itemLabel}
      </span>
      <PaginationContent className="flex-wrap gap-2">
        <PaginationItem className="flex items-center gap-2">
          <label htmlFor={pageSizeId}>Số hàng</label>
          <NativeSelect
            id={pageSizeId}
            aria-label="Số hàng mỗi trang"
            value={pageSize}
            onChange={(event) => onChange({
              page: 1,
              pageSize: Number(event.target.value) as PageSize,
            })}
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <NativeSelectOption key={option} value={option}>{option}</NativeSelectOption>
            ))}
          </NativeSelect>
        </PaginationItem>
        <PaginationItem>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={currentPage === 1}
            onClick={() => onChange({ page: currentPage - 1, pageSize })}
          >
            <ChevronLeftIcon aria-hidden="true" />
            Trang trước
          </Button>
        </PaginationItem>
        <PaginationItem aria-current="page" className="min-w-20 text-center font-medium text-foreground">
          Trang {numberFormatter.format(currentPage)} / {numberFormatter.format(totalPages)}
        </PaginationItem>
        <PaginationItem>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={totalItems === 0 || currentPage === totalPages}
            onClick={() => onChange({ page: currentPage + 1, pageSize })}
          >
            Trang sau
            <ChevronRightIcon aria-hidden="true" />
          </Button>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
