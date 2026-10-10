import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Payment,
  PaymentCurrency,
} from '../../../payments/entities/payment.entity';

@Controller('admin-api/payments')
@UseGuards(AdminApiGuard)
export class AdminApiPaymentsController {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
  ) {}

  @Get('total-revenue')
  async totalRevenue() {
    const rows: {
      currency: PaymentCurrency;
      total: string | number | null;
      paymentCount: string | number;
    }[] = await this.paymentRepository
      .createQueryBuilder('payment')
      .select('payment.currency', 'currency')
      .addSelect('SUM(payment.amount)', 'total')
      .addSelect('COUNT(*)', 'paymentCount')
      .where('payment.status = :status', {
        status: 'paid',
      })
      .groupBy('payment.currency')
      .getRawMany();

    const totalsByCurrency = rows.map((row) => ({
      currency: row.currency,
      total: Number(row.total ?? 0),
      paymentCount: Number(row.paymentCount ?? 0),
    }));

    return {
      totalsByCurrency,
    };
  }
}
