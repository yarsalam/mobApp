export class ArchiveReportDto {
  totalSize: number; // حجم کل دیتابیس (مگابایت)
  monthlyCost: number; // هزینه ماهانه (تومان)
  yearlyCost: number; // هزینه سالانه (تومان)

  recommendations: Array<{
    table: string;
    olderThan: Date;
    rows: number;
    size: number;
    costSaving: number; // صرفه‌جویی ماهانه (تومان)
    priority: 'high' | 'medium' | 'low';
    reason: string;
  }>;

  byTable: Record<
    string,
    {
      totalSize: number;
      oldestDate: Date;
      newestDate: Date;
      rowCount: number;
      monthlyGrowth: number; // درصد رشد ماهانه
    }
  >;

  warnings: string[]; // هشدارهای مهم
}
