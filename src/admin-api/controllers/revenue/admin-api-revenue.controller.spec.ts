import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { AdminApiRevenueController } from './admin-api-revenue.controller';

describe('AdminApiRevenueController customer segments', () => {
  function createController() {
    const revenueAnalytics = {
      customerSegments: jest.fn(async (days: number) => ({
        periodDays: days,
        segments: [],
      })),
    };
    const controller = new AdminApiRevenueController(
      {} as any,
      {} as any,
      {} as any,
      revenueAnalytics as any,
    );
    return { controller, revenueAnalytics };
  }

  it('uses a 90-day default and forwards a bounded requested window', async () => {
    const { controller, revenueAnalytics } = createController();

    await expect(controller.customerSegments()).resolves.toEqual({
      periodDays: 90,
      segments: [],
    });
    await controller.customerSegments('180');

    expect(revenueAnalytics.customerSegments).toHaveBeenNthCalledWith(1, 90);
    expect(revenueAnalytics.customerSegments).toHaveBeenNthCalledWith(2, 180);
  });

  it.each(['0', '29', '3651', '1.5', 'invalid'])(
    'rejects an invalid customer segment window: %s',
    async (days) => {
      const { controller, revenueAnalytics } = createController();

      await expect(controller.customerSegments(days)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(revenueAnalytics.customerSegments).not.toHaveBeenCalled();
    },
  );
});
