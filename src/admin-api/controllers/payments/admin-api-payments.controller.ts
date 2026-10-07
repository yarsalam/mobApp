import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminApiGuard } from '../../guards/api-key.guard';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from '../../../payments/entities/payment.entity';

@Controller('admin-api/payments')
@UseGuards(AdminApiGuard)
export class AdminApiPaymentsController {
  constructor(
    @InjectRepository(Payment)
    private paymentRepository: Repository<Payment>,
  ) {}

  @Get('total-revenue')
  async totalRevenue() {
    const result = await this.paymentRepository
      .createQueryBuilder('payment')
      .select('SUM(payment.amount)', 'total')
      .where('payment.status = :status', { status: 'success' })
      .getRawOne();
    return { total: result?.total || 0 };
  }
}
