import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { PartitionedEvent } from '../user-event/entities/partitioned-event.entity';
import { EventType } from '../user-event/type/event-type.enum';
import {
  AcquisitionCost,
  AcquisitionCostCurrency,
} from './entities/acquisition-cost.entity';
import { CreateAcquisitionCostDto } from './dto/create-acquisition-cost.dto';
import {
  acquisitionTouchFromUserMetadata,
  normalizeAcquisitionTouch,
} from './acquisition-attribution';

const SUPPORTED_CURRENCIES: AcquisitionCostCurrency[] = ['IRT', 'USDT', 'BTC', 'USD'];
const ACTIVE_EVENTS: EventType[] = [
  EventType.APP_OPEN,
  EventType.LOGIN,
  EventType.PROFILE_VIEW,
  EventType.LIKE,
  EventType.SUPERLIKE,
  EventType.MATCH,
  EventType.MESSAGE_SENT,
];
const MEANINGFUL_EVENTS: EventType[] = [
  EventType.LIKE,
  EventType.SUPERLIKE,
  EventType.MATCH,
  EventType.MESSAGE_SENT,
];
const DAY_MS = 86_400_000;

type CohortRow = {
  source: string;
  medium: string | null;
  campaign: string | null;
  campaignId: string | null;
  newUsers: number;
  profileCompletedUsers: number;
  firstInteractionUsers: number;
  d7EligibleUsers: number;
  d7RetainedUsers: number;
  d30EligibleUsers: number;
  d30RetainedUsers: number;
  firstPurchasers: number;
  grossPurchaseRevenueRials: number;
  costAmount: number | null;
  costCurrency: AcquisitionCostCurrency;
  cac: number | null;
  grossRevenuePerAcquiredUser: number | null;
  ltvOverCac: number | null;
};

function groupKey(source: string, medium: string | null, campaignId: string | null, campaign: string | null) {
  return JSON.stringify([source, medium, campaignId, campaignId ? null : campaign]);
}

function safeAmount(value: unknown): number | null {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

@Injectable()
export class AcquisitionGrowthService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(PartitionedEvent)
    private readonly events: Repository<PartitionedEvent>,
    @InjectRepository(AcquisitionCost)
    private readonly costs: Repository<AcquisitionCost>,
  ) {}

  async createCost(input: CreateAcquisitionCostDto, createdBy: string) {
    const normalizedSource = normalizeAcquisitionTouch({ source: input.source });
    const source = normalizedSource.source;
    if (!source || source.length > 80) {
      throw new BadRequestException('source is invalid');
    }
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000_000) {
      throw new BadRequestException('amount must be a finite non-negative amount');
    }
    if (!SUPPORTED_CURRENCIES.includes(input.currency)) {
      throw new BadRequestException('Unsupported acquisition cost currency');
    }
    if (!input.idempotencyKey || input.idempotencyKey.trim().length < 8) {
      throw new BadRequestException('A stable idempotencyKey of at least 8 characters is required');
    }
    const occurredAt = new Date(input.occurredAt);
    if (!Number.isFinite(occurredAt.getTime()) || occurredAt.getTime() > Date.now() + 86_400_000) {
      throw new BadRequestException('occurredAt is invalid or too far in the future');
    }

    const idempotencyKey = input.idempotencyKey.trim();
    const existing = await this.costs.findOne({ where: { idempotencyKey } });
    if (existing) {
      const samePayload =
        existing.source === source &&
        (existing.medium ?? null) === (input.medium?.trim().toLowerCase() || null) &&
        (existing.campaignId ?? null) === (input.campaignId?.trim() || null) &&
        Number(existing.amount) === Number(amount.toFixed(2)) &&
        existing.currency === input.currency &&
        existing.category === input.category;
      if (!samePayload) {
        throw new BadRequestException('idempotencyKey was already used for a different cost entry');
      }
      return { success: true, duplicate: true, cost: existing };
    }

    const entity = this.costs.create({
      source,
      medium: input.medium?.trim().toLowerCase() || null,
      campaign: input.campaign?.trim() || null,
      campaignId: input.campaignId?.trim() || null,
      category: input.category,
      amount: amount.toFixed(2),
      currency: input.currency,
      occurredAt,
      notes: input.notes?.trim() || null,
      createdBy: createdBy.slice(0, 128),
      idempotencyKey,
    });
    try {
      const saved = await this.costs.save(entity);
      return { success: true, duplicate: false, cost: saved };
    } catch (error: any) {
      // A concurrent retry may win the unique idempotency-key race.
      if (error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062) {
        const duplicate = await this.costs.findOne({ where: { idempotencyKey } });
        if (duplicate) return { success: true, duplicate: true, cost: duplicate };
      }
      throw error;
    }
  }

  async getReport(days = 90, currency: AcquisitionCostCurrency = 'IRT') {
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      throw new BadRequestException('days must be an integer between 1 and 3650');
    }
    if (!SUPPORTED_CURRENCIES.includes(currency)) {
      throw new BadRequestException('Unsupported currency');
    }

    const now = new Date();
    const since = new Date(now.getTime() - days * DAY_MS);
    const cohortUsers = await this.users.find({
      where: { createdAt: Between(since, now) },
      select: ['id', 'createdAt', 'isCompleted', 'acquisitionSource', 'acquisitionKeyword', 'metadata'],
      order: { createdAt: 'ASC' },
    });

    const grouped = new Map<string, CohortRow>();
    const userGroups = new Map<number, string>();
    const firstInteractionUsers = new Set<number>();
    const d7Users = new Set<number>();
    const d30Users = new Set<number>();
    const d7Retained = new Set<number>();
    const d30Retained = new Set<number>();
    const firstPurchasers = new Set<number>();
    const purchaseRevenueByGroup = new Map<string, number>();

    for (const user of cohortUsers) {
      const touch = acquisitionTouchFromUserMetadata(user.acquisitionSource, user.metadata);
      const metadata = user.metadata && typeof user.metadata === 'object'
        ? user.metadata as Record<string, unknown>
        : {};
      const acquisition = metadata.acquisition && typeof metadata.acquisition === 'object'
        ? metadata.acquisition as Record<string, unknown>
        : {};
      const firstTouch = acquisition.firstTouch && typeof acquisition.firstTouch === 'object'
        ? acquisition.firstTouch as Record<string, unknown>
        : {};
      const campaignId = typeof firstTouch.campaignId === 'string' ? firstTouch.campaignId : touch.campaignId;
      const campaign = touch.campaign;
      const key = groupKey(touch.source, touch.medium, campaignId, campaign);
      userGroups.set(user.id, key);

      let row = grouped.get(key);
      if (!row) {
        row = {
          source: touch.source,
          medium: touch.medium,
          campaign,
          campaignId,
          newUsers: 0,
          profileCompletedUsers: 0,
          firstInteractionUsers: 0,
          d7EligibleUsers: 0,
          d7RetainedUsers: 0,
          d30EligibleUsers: 0,
          d30RetainedUsers: 0,
          firstPurchasers: 0,
          grossPurchaseRevenueRials: 0,
          costAmount: null,
          costCurrency: currency,
          cac: null,
          grossRevenuePerAcquiredUser: currency === 'IRT' ? null : null,
          ltvOverCac: null,
        };
        grouped.set(key, row);
      }
      row.newUsers += 1;
      if (user.isCompleted) row.profileCompletedUsers += 1;
      const ageMs = now.getTime() - new Date(user.createdAt).getTime();
      if (ageMs >= 7 * DAY_MS) {
        row.d7EligibleUsers += 1;
        d7Users.add(user.id);
      }
      if (ageMs >= 30 * DAY_MS) {
        row.d30EligibleUsers += 1;
        d30Users.add(user.id);
      }
    }

    const userIds = cohortUsers.map(user => user.id);
    const userById = new Map(cohortUsers.map(user => [user.id, user]));
    const eventRows: PartitionedEvent[] = [];
    for (let offset = 0; offset < userIds.length; offset += 500) {
      const ids = userIds.slice(offset, offset + 500);
      const events = await this.events.find({
        where: { userId: In(ids), createdAt: Between(since, now) },
        order: { createdAt: 'ASC' },
      });
      eventRows.push(...events);
    }

    for (const event of eventRows) {
      const user = userById.get(event.userId);
      const key = userGroups.get(event.userId);
      const row = key ? grouped.get(key) : undefined;
      if (!user || !row) continue;
      const createdAt = new Date(user.createdAt).getTime();
      const eventAt = new Date(event.createdAt).getTime();
      if (!Number.isFinite(eventAt) || eventAt < createdAt) continue;
      const daysSinceRegistration = Math.floor((eventAt - createdAt) / DAY_MS);

      if (MEANINGFUL_EVENTS.includes(event.type) && daysSinceRegistration <= 30) {
        firstInteractionUsers.add(event.userId);
      }
      if (d7Users.has(event.userId) && daysSinceRegistration >= 7 && daysSinceRegistration < 14 && ACTIVE_EVENTS.includes(event.type)) {
        d7Retained.add(event.userId);
      }
      if (d30Users.has(event.userId) && daysSinceRegistration >= 30 && daysSinceRegistration < 37 && ACTIVE_EVENTS.includes(event.type)) {
        d30Retained.add(event.userId);
      }

      if (event.type === EventType.PURCHASE) {
        const meta = event.metadata && typeof event.metadata === 'object'
          ? event.metadata as Record<string, unknown>
          : {};
        if (meta.isCommercialPurchase !== true) continue;
        if (meta.currency !== currency) continue;
        const amount = safeAmount(meta.amountRials);
        if (amount === null || amount <= 0) continue;
        firstPurchasers.add(event.userId);
        purchaseRevenueByGroup.set(key, (purchaseRevenueByGroup.get(key) ?? 0) + amount);
      }
    }

    for (const userId of firstInteractionUsers) {
      const key = userGroups.get(userId);
      const row = key ? grouped.get(key) : undefined;
      if (row) row.firstInteractionUsers += 1;
    }
    for (const userId of d7Retained) {
      const key = userGroups.get(userId);
      const row = key ? grouped.get(key) : undefined;
      if (row) row.d7RetainedUsers += 1;
    }
    for (const userId of d30Retained) {
      const key = userGroups.get(userId);
      const row = key ? grouped.get(key) : undefined;
      if (row) row.d30RetainedUsers += 1;
    }
    for (const userId of firstPurchasers) {
      const key = userGroups.get(userId);
      const row = key ? grouped.get(key) : undefined;
      if (row) row.firstPurchasers += 1;
    }
    for (const [key, revenue] of purchaseRevenueByGroup) {
      const row = grouped.get(key);
      if (row) row.grossPurchaseRevenueRials = revenue;
    }

    const costRows = await this.costs.find({
      where: { occurredAt: Between(since, now), currency },
      order: { occurredAt: 'ASC' },
    });
    const costTotals = new Map<string, number>();
    const costPresence = new Set<string>();
    for (const cost of costRows) {
      const source = cost.source.trim().toLowerCase();
      const medium = cost.medium?.trim().toLowerCase() || null;
      const key = groupKey(source, medium, cost.campaignId ?? null, cost.campaignId ? null : cost.campaign ?? null);
      costPresence.add(key);
      costTotals.set(key, (costTotals.get(key) ?? 0) + Number(cost.amount));
      if (!grouped.has(key)) {
        grouped.set(key, {
          source,
          medium,
          campaign: cost.campaign ?? null,
          campaignId: cost.campaignId ?? null,
          newUsers: 0,
          profileCompletedUsers: 0,
          firstInteractionUsers: 0,
          d7EligibleUsers: 0,
          d7RetainedUsers: 0,
          d30EligibleUsers: 0,
          d30RetainedUsers: 0,
          firstPurchasers: 0,
          grossPurchaseRevenueRials: 0,
          costAmount: null,
          costCurrency: currency,
          cac: null,
          grossRevenuePerAcquiredUser: null,
          ltvOverCac: null,
        });
      }
    }

    const rows = [...grouped.entries()].map(([key, row]) => {
      const hasCost = costPresence.has(key);
      const costAmount = hasCost ? costTotals.get(key)! : null;
      const grossRevenuePerAcquiredUser =
        currency === 'IRT' && row.newUsers > 0
          ? row.grossPurchaseRevenueRials / row.newUsers
          : null;
      const cac = hasCost && row.newUsers > 0
        ? costAmount! / row.newUsers
        : null;
      return {
        ...row,
        costAmount,
        cac,
        grossRevenuePerAcquiredUser,
        profileCompletionRatePercent: row.newUsers > 0
          ? Math.round((row.profileCompletedUsers / row.newUsers) * 10_000) / 100
          : null,
        firstInteractionRatePercent: row.newUsers > 0
          ? Math.round((row.firstInteractionUsers / row.newUsers) * 10_000) / 100
          : null,
        d7RetentionRatePercent: row.d7EligibleUsers > 0
          ? Math.round((row.d7RetainedUsers / row.d7EligibleUsers) * 10_000) / 100
          : null,
        d30RetentionRatePercent: row.d30EligibleUsers > 0
          ? Math.round((row.d30RetainedUsers / row.d30EligibleUsers) * 10_000) / 100
          : null,
        ltvOverCac: cac !== null && cac > 0 && grossRevenuePerAcquiredUser !== null
          ? Math.round((grossRevenuePerAcquiredUser / cac) * 100) / 100
          : null,
      };
    }).sort((a, b) => b.newUsers - a.newUsers || a.source.localeCompare(b.source));

    return {
      currency,
      unit: currency === 'IRT' ? 'rial' : 'native_currency_units',
      periodDays: days,
      attributionModel: 'first_touch',
      costCoverage: costRows.length > 0 ? 'cost_data_present_completeness_unverified' : 'no_cost_data',
      rows,
      interpretation: 'observational_descriptive_only; CAC is null unless explicit cost entries exist for the same source, medium, campaign and currency; gross product purchase revenue is based on fulfilled commercial purchase events and excludes wallet top-ups; refunds and chargebacks are not yet reconciled; no causal lift or LTV improvement is inferred',
      limitations: [
        'D7 retention is measured in days 7–13 after registration and only among cohorts at least 7 days old.',
        'D30 retention is measured in days 30–36 after registration and only among cohorts at least 30 days old.',
        'Meaningful interaction is LIKE, SUPERLIKE, MATCH or MESSAGE_SENT.',
        'Gross revenue is currently available only in IRT from the commercial purchase event ledger.',
        'Google Search Console, Bing Webmaster and AI answer citation/impression feeds are not automatically imported by this endpoint.',
      ],
    };
  }
}
