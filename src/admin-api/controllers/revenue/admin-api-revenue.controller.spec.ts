import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { AdminApiRevenueController } from './admin-api-revenue.controller';
import { PricingExperimentService } from '../../../pricing-experiments/pricing-experiment.service';

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
      { getExperimentReport: jest.fn(async (experimentId: string, days: number) => ({ experimentId, periodDays: days })) } as any,
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

describe('AdminApiRevenueController pricing experiment report', () => {
  function createController() {
    const pricingExperiments = {
      getExperimentReport: jest.fn(async (experimentId: string, days: number) => ({
        experimentId,
        periodDays: days,
      })),
    };
    const controller = new AdminApiRevenueController(
      {} as any,
      {} as any,
      {} as any,
      { customerSegments: jest.fn() } as any,
      pricingExperiments as any,
    );
    return { controller, pricingExperiments };
  }

  it('returns a bounded report with a 90-day default', async () => {
    const { controller, pricingExperiments } = createController();
    await expect(controller.pricingExperimentReport('welcome_discount')).resolves.toEqual({
      experimentId: 'welcome_discount',
      periodDays: 90,
    });
    await controller.pricingExperimentReport('welcome_discount', '30');
    expect(pricingExperiments.getExperimentReport).toHaveBeenNthCalledWith(1, 'welcome_discount', 90);
    expect(pricingExperiments.getExperimentReport).toHaveBeenNthCalledWith(2, 'welcome_discount', 30);
  });

  it.each(['bad id', '../x', ''])('rejects invalid experiment IDs: %s', async experimentId => {
    const { controller, pricingExperiments } = createController();
    await expect(controller.pricingExperimentReport(experimentId)).rejects.toBeInstanceOf(BadRequestException);
    expect(pricingExperiments.getExperimentReport).not.toHaveBeenCalled();
  });

  it.each(['0', '3651', '1.2', 'nope'])('rejects invalid report windows: %s', async days => {
    const { controller, pricingExperiments } = createController();
    await expect(controller.pricingExperimentReport('welcome_discount', days)).rejects.toBeInstanceOf(BadRequestException);
    expect(pricingExperiments.getExperimentReport).not.toHaveBeenCalled();
  });
});
