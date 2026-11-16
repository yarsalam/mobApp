import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductBundle } from './entities/product-bundle.entity';

export type BundleItemType = 'credits' | 'boost' | 'vip';
export interface BundleItemInput {
  type: BundleItemType;
  amount: number;
  durationDays?: number;
}

@Injectable()
export class ProductService {
  constructor(
    @InjectRepository(ProductBundle)
    private readonly bundles: Repository<ProductBundle>,
  ) {}

  private normalizeItems(value: unknown): BundleItemInput[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
      throw new BadRequestException('items must contain between 1 and 10 bundle items');
    }
    return value.map((raw, index) => {
      if (!raw || typeof raw !== 'object') {
        throw new BadRequestException('Each bundle item must be an object');
      }
      const item = raw as Record<string, unknown>;
      if (!['credits', 'boost', 'vip'].includes(String(item.type))) {
        throw new BadRequestException('Bundle item type must be credits, boost or vip');
      }
      const amount = Number(item.amount);
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000) {
        throw new BadRequestException('Bundle item amount must be an integer from 1 to 1000000');
      }
      if (item.type === 'vip') {
        const durationDays = Number(item.durationDays);
        if (!Number.isSafeInteger(durationDays) || durationDays < 1 || durationDays > 3650) {
          throw new BadRequestException('VIP durationDays must be an integer from 1 to 3650');
        }
        return { type: 'vip', amount, durationDays };
      }
      return { type: item.type as BundleItemType, amount };
    });
  }

  private normalize(input: Record<string, unknown>) {
    if (typeof input.code !== 'string' || !input.code.trim() || input.code.trim().length > 255) {
      throw new BadRequestException('code is required and must be at most 255 characters');
    }
    const price = Number(input.price);
    if (!Number.isSafeInteger(price) || price < 1 || price > 1_000_000_000) {
      throw new BadRequestException('price must be an integer IRT amount from 1 to 1000000000');
    }
    if (input.active !== undefined && typeof input.active !== 'boolean') {
      throw new BadRequestException('active must be boolean');
    }
    return {
      code: input.code.trim(),
      items: this.normalizeItems(input.items),
      price,
      active: input.active === undefined ? true : input.active,
    };
  }

  async getAll() {
    return this.bundles.find({ order: { price: 'ASC', id: 'ASC' } });
  }

  async create(input: Record<string, unknown>) {
    const normalized = this.normalize(input);
    return this.bundles.save(this.bundles.create(normalized));
  }

  async update(id: number, input: Record<string, unknown>) {
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new BadRequestException('Product ID is invalid');
    }
    const current = await this.bundles.findOne({ where: { id } });
    if (!current) throw new NotFoundException('Product bundle not found');
    const normalized = this.normalize({
      code: input.code === undefined ? current.code : input.code,
      items: input.items === undefined ? current.items : input.items,
      price: input.price === undefined ? current.price : input.price,
      active: input.active === undefined ? current.active : input.active,
    });
    return this.bundles.save({ ...current, ...normalized });
  }

  async disable(id: number) {
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new BadRequestException('Product ID is invalid');
    }
    const result = await this.bundles.update({ id }, { active: false });
    if (!result.affected) throw new NotFoundException('Product bundle not found');
    return { success: true, id, active: false };
  }
}
