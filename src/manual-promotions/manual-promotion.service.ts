import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { PhaseService } from '../phase/phase.service';
import { ProductBundle } from '../product/entities/product-bundle.entity';
import { User } from '../users/entities/user.entity';
import { ManualPromotionCampaign } from './entities/manual-promotion-campaign.entity';
import { ManualPromotionRedemption } from './entities/manual-promotion-redemption.entity';

const COUNTED_STATUSES = ['reserved', 'redeemed'] as const;
const VALID_PHASES = ['cold', 'warm', 'hot'] as const;

export interface ManualPromotionQuote {
  campaignId: string;
  bundleCode: string;
  currency: 'IRT';
  basePriceRials: number;
  discountRials: number;
  payablePriceRials: number;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  title: string;
  subtitle: string;
  expiresAt: string;
}

@Injectable()
export class ManualPromotionService {
  constructor(
    @InjectRepository(ManualPromotionCampaign)
    private readonly campaigns: Repository<ManualPromotionCampaign>,
    @InjectRepository(ManualPromotionRedemption)
    private readonly redemptions: Repository<ManualPromotionRedemption>,
    @InjectRepository(ProductBundle)
    private readonly bundles: Repository<ProductBundle>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly phases: PhaseService,
    private readonly dataSource: DataSource,
  ) {}

  private parseDate(value: unknown, field: string): Date {
    const date = value instanceof Date ? value : new Date(String(value ?? ''));
    if (!Number.isFinite(date.getTime())) {
      throw new BadRequestException(`${field} must be a valid date`);
    }
    return date;
  }

  private validateText(value: unknown, field: string, max: number): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
      throw new BadRequestException(`${field} is required and must be at most ${max} characters`);
    }
    return value.trim();
  }

  private normalizeInput(input: Record<string, any>, partial = false) {
    const result: Record<string, any> = {};
    const assign = (key: string, value: unknown) => {
      if (value !== undefined) result[key] = value;
      else if (!partial) throw new BadRequestException(`${key} is required`);
    };

    assign('name', input.name === undefined && partial ? undefined : this.validateText(input.name, 'name', 120));
    assign('title', input.title === undefined && partial ? undefined : this.validateText(input.title, 'title', 120));
    assign('subtitle', input.subtitle === undefined && partial ? undefined : this.validateText(input.subtitle, 'subtitle', 280));
    assign('ctaText', input.ctaText === undefined && partial ? undefined : this.validateText(input.ctaText ?? 'مشاهده پیشنهاد', 'ctaText', 60));
    assign('bundleCode', input.bundleCode === undefined && partial ? undefined : this.validateText(input.bundleCode, 'bundleCode', 255));

    if (input.discountType !== undefined || !partial) {
      if (!['percent', 'fixed'].includes(input.discountType)) {
        throw new BadRequestException('discountType must be percent or fixed');
      }
      result.discountType = input.discountType;
    }
    if (input.discountValue !== undefined || !partial) {
      const value = Number(input.discountValue);
      const max = result.discountType === 'percent' || input.discountType === 'percent' ? 90 : 100_000_000;
      if (!Number.isSafeInteger(value) || value < 1 || value > max) {
        throw new BadRequestException(`discountValue must be an integer between 1 and ${max}`);
      }
      result.discountValue = value;
    }

    if (input.audienceType !== undefined || !partial) {
      if (!['all', 'users', 'phases'].includes(input.audienceType)) {
        throw new BadRequestException('audienceType must be all, users or phases');
      }
      result.audienceType = input.audienceType;
    }
    const audienceType = result.audienceType ?? input.audienceType;
    if (input.audienceUserIds !== undefined || (!partial && audienceType === 'users')) {
      const ids = input.audienceUserIds;
      if (!Array.isArray(ids) || ids.length === 0 ||
          !ids.every((id) => Number.isSafeInteger(Number(id)) && Number(id) > 0)) {
        throw new BadRequestException('audienceUserIds must contain positive user IDs');
      }
      result.audienceUserIds = [...new Set(ids.map(Number))];
    }
    if (input.audiencePhases !== undefined || (!partial && audienceType === 'phases')) {
      const values = input.audiencePhases;
      if (!Array.isArray(values) || values.length === 0 ||
          !values.every((phase) => VALID_PHASES.includes(phase))) {
        throw new BadRequestException('audiencePhases must contain cold, warm or hot');
      }
      result.audiencePhases = [...new Set(values)];
    }
    if (audienceType === 'all') {
      result.audienceUserIds = null;
      result.audiencePhases = null;
    }

    if (input.startsAt !== undefined || !partial) {
      result.startsAt = this.parseDate(input.startsAt, 'startsAt');
    }
    if (input.endsAt !== undefined || !partial) {
      result.endsAt = this.parseDate(input.endsAt, 'endsAt');
    }
    if (result.startsAt && result.endsAt && result.endsAt <= result.startsAt) {
      throw new BadRequestException('endsAt must be later than startsAt');
    }

    if (input.maxRedemptions !== undefined || !partial) {
      const value = input.maxRedemptions;
      if (value === undefined || value === null || value === '') result.maxRedemptions = null;
      else {
        const n = Number(value);
        if (!Number.isSafeInteger(n) || n < 1 || n > 1_000_000) {
          throw new BadRequestException('maxRedemptions must be null or an integer from 1 to 1000000');
        }
        result.maxRedemptions = n;
      }
    }
    if (input.perUserLimit !== undefined || !partial) {
      const n = Number(input.perUserLimit ?? 1);
      if (!Number.isSafeInteger(n) || n < 1 || n > 100) {
        throw new BadRequestException('perUserLimit must be an integer from 1 to 100');
      }
      result.perUserLimit = n;
    }
    if (input.priority !== undefined || !partial) {
      const n = Number(input.priority ?? 0);
      if (!Number.isSafeInteger(n) || n < -1000 || n > 1000) {
        throw new BadRequestException('priority must be an integer from -1000 to 1000');
      }
      result.priority = n;
    }
    if (input.active !== undefined || !partial) {
      if (input.active !== undefined && typeof input.active !== 'boolean') {
        throw new BadRequestException('active must be boolean');
      }
      result.active = input.active === true;
    }
    return result;
  }

  async createCampaign(input: Record<string, any>) {
    const normalized = this.normalizeInput(input);
    const bundle = await this.bundles.findOne({
      where: { code: normalized.bundleCode, active: true },
    });
    if (!bundle) throw new BadRequestException('An active product bundle is required');
    if (normalized.discountType === 'fixed' && normalized.discountValue >= bundle.price) {
      throw new BadRequestException('Fixed discount must be lower than the current bundle price');
    }
    if (normalized.discountType === 'percent') {
      normalized.discountValue = Math.min(90, normalized.discountValue);
    }
    return this.campaigns.save(this.campaigns.create({ id: randomUUID(), ...normalized }));
  }

  async listCampaigns() {
    const rows = await this.campaigns.find({ order: { createdAt: 'DESC' } });
    return Promise.all(rows.map(async (campaign) => ({
      ...campaign,
      reservedCount: await this.redemptions.count({
        where: { campaignId: campaign.id, status: 'reserved' },
      }),
      redeemedCount: await this.redemptions.count({
        where: { campaignId: campaign.id, status: 'redeemed' },
      }),
    })));
  }

  async updateCampaign(id: string, input: Record<string, any>) {
    const campaign = await this.campaigns.findOne({ where: { id } });
    if (!campaign) throw new NotFoundException('Manual promotion not found');
    // Normalize the merged object so a partial update cannot bypass the
    // discount bounds by omitting the existing discount type.
    const normalized = this.normalizeInput({ ...campaign, ...input });
    const changedTerms = [
      'bundleCode', 'discountType', 'discountValue', 'audienceType',
      'audienceUserIds', 'audiencePhases', 'startsAt', 'endsAt',
      'maxRedemptions', 'perUserLimit',
    ].some((key) => normalized[key] !== undefined &&
      JSON.stringify(normalized[key]) !== JSON.stringify((campaign as any)[key]));
    const used = await this.redemptions.count({
      where: { campaignId: id, status: In([...COUNTED_STATUSES]) },
    });
    if (used > 0 && changedTerms) {
      throw new ConflictException('Discount, product, audience and redemption limits are immutable after a reservation; disable this campaign and create a new one');
    }
    const next = { ...campaign, ...normalized };
    if (next.endsAt <= next.startsAt) throw new BadRequestException('endsAt must be later than startsAt');
    if (next.discountType === 'fixed') {
      const bundle = await this.bundles.findOne({ where: { code: next.bundleCode, active: true } });
      if (!bundle || next.discountValue >= bundle.price) {
        throw new BadRequestException('Fixed discount must be lower than the current bundle price');
      }
    }
    return this.campaigns.save(next);
  }

  async disableCampaign(id: string) {
    const result = await this.campaigns.update({ id }, { active: false });
    if (!result.affected) throw new NotFoundException('Manual promotion not found');
    return { success: true, id, active: false };
  }

  private async assertActiveUser(userId: number) {
    const user = await this.users.findOne({
      where: { id: userId },
      select: ['id', 'status'],
    });
    if (!user || user.status !== 'active') {
      throw new NotFoundException('Promotion is not available');
    }
  }

  private async getPhase(userId: number): Promise<string> {
    const result = await this.phases.get(userId);
    return VALID_PHASES.includes(result.phase as any) ? result.phase : 'cold';
  }

  private isAudienceEligible(
    campaign: ManualPromotionCampaign,
    userId: number,
    phase: string,
  ): boolean {
    if (campaign.audienceType === 'all') return true;
    if (campaign.audienceType === 'users') return (campaign.audienceUserIds ?? []).includes(userId);
    if (campaign.audienceType === 'phases') return (campaign.audiencePhases ?? []).includes(phase);
    return false;
  }

  private async calculateQuote(
    campaign: ManualPromotionCampaign,
    userId: number,
    bundleCode: string,
    phase?: string,
  ): Promise<ManualPromotionQuote> {
    await this.assertActiveUser(userId);
    const now = new Date();
    if (!campaign.active || campaign.startsAt > now || campaign.endsAt <= now) {
      throw new NotFoundException('Promotion is not available');
    }
    if (campaign.bundleCode !== bundleCode) throw new NotFoundException('Promotion is not available');
    const currentPhase = phase ?? await this.getPhase(userId);
    if (!this.isAudienceEligible(campaign, userId, currentPhase)) {
      throw new NotFoundException('Promotion is not available');
    }
    const bundle = await this.bundles.findOne({ where: { code: bundleCode, active: true } });
    if (!bundle || !Number.isSafeInteger(bundle.price) || bundle.price <= 0) {
      throw new NotFoundException('Product is not available');
    }
    const [globalCount, userCount] = await Promise.all([
      this.redemptions.count({
        where: { campaignId: campaign.id, status: In([...COUNTED_STATUSES]) },
      }),
      this.redemptions.count({
        where: { campaignId: campaign.id, userId, status: In([...COUNTED_STATUSES]) },
      }),
    ]);
    if ((campaign.maxRedemptions !== null && globalCount >= campaign.maxRedemptions) ||
        userCount >= campaign.perUserLimit) {
      throw new ConflictException('Promotion redemption limit has been reached');
    }
    const discountRials = campaign.discountType === 'percent'
      ? Math.floor(bundle.price * campaign.discountValue / 100)
      : campaign.discountValue;
    const payablePriceRials = bundle.price - discountRials;
    if (!Number.isSafeInteger(discountRials) || discountRials <= 0 ||
        !Number.isSafeInteger(payablePriceRials) || payablePriceRials <= 0) {
      throw new ConflictException('Promotion discount is no longer valid for this product');
    }
    return {
      campaignId: campaign.id,
      bundleCode,
      currency: 'IRT',
      basePriceRials: bundle.price,
      discountRials,
      payablePriceRials,
      discountType: campaign.discountType,
      discountValue: campaign.discountValue,
      title: campaign.title,
      subtitle: campaign.subtitle,
      expiresAt: campaign.endsAt.toISOString(),
    };
  }

  async getQuote(userId: number, campaignId: string, bundleCode: string) {
    const campaign = await this.campaigns.findOne({ where: { id: campaignId } });
    if (!campaign) throw new NotFoundException('Promotion is not available');
    return this.calculateQuote(campaign, userId, bundleCode);
  }

  async getCampaignForFeed(userId: number, phase: string) {
    const now = new Date();
    const campaigns = await this.campaigns.find({
      where: { active: true },
      order: { priority: 'DESC', createdAt: 'ASC' },
      take: 50,
    });
    for (const campaign of campaigns) {
      if (campaign.startsAt > now || campaign.endsAt <= now ||
          !this.isAudienceEligible(campaign, userId, phase)) continue;
      try {
        const quote = await this.calculateQuote(campaign, userId, campaign.bundleCode, phase);
        return { campaign, quote };
      } catch {
        // An expired, exhausted or otherwise ineligible campaign must not block
        // lower-priority campaigns or the automatic promotion engine.
      }
    }
    return null;
  }

  async reserveForCheckout(
    userId: number,
    campaignId: string,
    bundleCode: string,
    checkoutKey: string,
  ) {
    if (!checkoutKey?.trim() || checkoutKey.length > 80) {
      throw new BadRequestException('A valid checkout idempotency key is required');
    }
    return this.dataSource.transaction(async (manager) => {
      const campaignRepo = manager.getRepository(ManualPromotionCampaign);
      const redemptionRepo = manager.getRepository(ManualPromotionRedemption);
      const bundleRepo = manager.getRepository(ProductBundle);
      const campaign = await campaignRepo.findOne({
        where: { id: campaignId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!campaign) throw new NotFoundException('Promotion is not available');

      const existing = await redemptionRepo.findOne({
        where: { campaignId, userId, checkoutKey },
      });
      if (existing) {
        if (existing.bundleCode !== bundleCode || existing.status === 'released') {
          throw new ConflictException('This checkout key cannot be reused for this promotion');
        }
        return {
          campaignId,
          redemptionId: existing.id,
          bundleCode,
          basePriceRials: existing.basePriceRials,
          discountRials: existing.discountRials,
          payablePriceRials: existing.payablePriceRials,
        };
      }

      await this.assertActiveUser(userId);
      const now = new Date();
      if (!campaign.active || campaign.startsAt > now || campaign.endsAt <= now ||
          campaign.bundleCode !== bundleCode) {
        throw new NotFoundException('Promotion is not available');
      }
      const phaseResult = await this.phases.get(userId);
      const phase = VALID_PHASES.includes(phaseResult.phase as any) ? phaseResult.phase : 'cold';
      if (!this.isAudienceEligible(campaign, userId, phase)) {
        throw new NotFoundException('Promotion is not available');
      }
      const bundle = await bundleRepo.findOne({ where: { code: bundleCode, active: true } });
      if (!bundle || !Number.isSafeInteger(bundle.price) || bundle.price <= 0) {
        throw new NotFoundException('Product is not available');
      }
      const [globalCount, userCount] = await Promise.all([
        redemptionRepo.count({ where: { campaignId, status: In([...COUNTED_STATUSES]) } }),
        redemptionRepo.count({ where: { campaignId, userId, status: In([...COUNTED_STATUSES]) } }),
      ]);
      if ((campaign.maxRedemptions !== null && globalCount >= campaign.maxRedemptions) ||
          userCount >= campaign.perUserLimit) {
        throw new ConflictException('Promotion redemption limit has been reached');
      }
      const discountRials = campaign.discountType === 'percent'
        ? Math.floor(bundle.price * campaign.discountValue / 100)
        : campaign.discountValue;
      const payablePriceRials = bundle.price - discountRials;
      if (!Number.isSafeInteger(discountRials) || discountRials <= 0 ||
          !Number.isSafeInteger(payablePriceRials) || payablePriceRials <= 0) {
        throw new ConflictException('Promotion discount is no longer valid for this product');
      }
      const redemption = await redemptionRepo.save(redemptionRepo.create({
        id: randomUUID(),
        campaignId,
        userId,
        bundleCode,
        checkoutKey,
        basePriceRials: bundle.price,
        discountRials,
        payablePriceRials,
        status: 'reserved',
        redeemedAt: null,
      }));
      return {
        campaignId,
        redemptionId: redemption.id,
        bundleCode,
        basePriceRials: bundle.price,
        discountRials,
        payablePriceRials,
      };
    });
  }

  async markRedeemed(campaignId: string, redemptionId: string, userId: number) {
    const redemption = await this.redemptions.findOne({
      where: { id: redemptionId, campaignId, userId },
    });
    if (!redemption) throw new NotFoundException('Promotion reservation not found');
    if (redemption.status === 'redeemed') return { success: true, duplicate: true };
    if (redemption.status !== 'reserved') throw new ConflictException('Promotion reservation is not redeemable');
    const updated = await this.redemptions.update(
      { id: redemptionId, campaignId, userId, status: 'reserved' },
      { status: 'redeemed', redeemedAt: new Date() },
    );
    if (!updated.affected) {
      const latest = await this.redemptions.findOne({ where: { id: redemptionId, campaignId, userId } });
      if (latest?.status === 'redeemed') return { success: true, duplicate: true };
      throw new ConflictException('Promotion reservation is not redeemable');
    }
    return { success: true, duplicate: false };
  }

  async releaseReservation(campaignId: string, redemptionId: string, userId: number) {
    await this.redemptions.update(
      { id: redemptionId, campaignId, userId, status: 'reserved' },
      { status: 'released' },
    );
    return { success: true };
  }

  async getCampaignReport(id: string) {
    const campaign = await this.campaigns.findOne({ where: { id } });
    if (!campaign) throw new NotFoundException('Manual promotion not found');
    const [reserved, redeemed, released, discount] = await Promise.all([
      this.redemptions.count({ where: { campaignId: id, status: 'reserved' } }),
      this.redemptions.count({ where: { campaignId: id, status: 'redeemed' } }),
      this.redemptions.count({ where: { campaignId: id, status: 'released' } }),
      this.redemptions.createQueryBuilder('redemption')
        .select('COALESCE(SUM(redemption.discountRials), 0)', 'discountRials')
        .where('redemption.campaignId = :id', { id })
        .andWhere('redemption.status = :status', { status: 'redeemed' })
        .getRawOne(),
    ]);
    return {
      campaignId: id,
      reserved,
      redeemed,
      released,
      discountRials: Number(discount?.discountRials ?? 0),
      maxRedemptions: campaign.maxRedemptions,
      active: campaign.active,
    };
  }
}
