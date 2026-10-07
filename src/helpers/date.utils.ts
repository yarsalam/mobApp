import dayjs, { Dayjs } from 'dayjs';
import jalali from 'jalaliday';

dayjs.extend(jalali);

/**
 * تبدیل تاریخ میلادی به شمسی (تاریخ و زمان جداگانه)
 * @param date تاریخ میلادی (Date یا string)
 * @returns یک آبجکت شامل تاریخ و زمان شمسی جداگانه
 */
export function formatToJalali(date: Date | string): {
  date: string;
  time: string;
} {
  const d: Dayjs = dayjs(date).calendar('jalali').locale('fa');
  return {
    date: d.format('YYYY/MM/DD'),
    time: d.format('HH:mm'),
  };
}
