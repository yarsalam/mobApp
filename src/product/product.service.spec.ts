import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductService } from './product.service';

function makeService() {
  const rows = new Map<number, any>();
  let nextId = 1;
  const repository: any = {
    find: jest.fn(async () => [...rows.values()]),
    findOne: jest.fn(async ({ where }: any) => rows.get(where.id) ?? null),
    create: jest.fn((value: any) => ({ id: nextId++, ...value })),
    save: jest.fn(async (value: any) => {
      rows.set(value.id, value);
      return value;
    }),
    update: jest.fn(async ({ id }: any, patch: any) => {
      const current = rows.get(id);
      if (!current) return { affected: 0 };
      rows.set(id, { ...current, ...patch });
      return { affected: 1 };
    }),
  };
  return { service: new ProductService(repository), repository, rows };
}

describe('ProductService admin bundle CRUD', () => {
  it('creates an active bundle with credits, boost and VIP entitlements', async () => {
    const h = makeService();
    const bundle = await h.service.create({
      code: 'starter-bundle',
      price: 250_000,
      items: [
        { type: 'credits', amount: 20 },
        { type: 'boost', amount: 2 },
        { type: 'vip', amount: 1, durationDays: 30 },
      ],
    });
    expect(bundle).toMatchObject({
      id: 1,
      code: 'starter-bundle',
      price: 250_000,
      active: true,
      items: [
        { type: 'credits', amount: 20 },
        { type: 'boost', amount: 2 },
        { type: 'vip', amount: 1, durationDays: 30 },
      ],
    });
  });

  it('rejects non-positive, fractional or unsafe prices and invalid item payloads', async () => {
    const h = makeService();
    const valid = {
      code: 'bundle-a',
      price: 100_000,
      items: [{ type: 'credits', amount: 20 }],
    };
    await expect(h.service.create({ ...valid, price: 0 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.create({ ...valid, price: 100_000.5 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.create({ ...valid, items: [{ type: 'vip', amount: 1 }] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.create({ ...valid, items: [{ type: 'unknown', amount: 1 }] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates partial product fields and keeps existing item definitions', async () => {
    const h = makeService();
    const created = await h.service.create({
      code: 'bundle-a',
      price: 100_000,
      items: [{ type: 'credits', amount: 20 }],
    });
    const updated = await h.service.update(created.id, { price: 120_000 });
    expect(updated.price).toBe(120_000);
    expect(updated.items).toEqual([{ type: 'credits', amount: 20 }]);
  });

  it('soft-disables a bundle so historical references are preserved', async () => {
    const h = makeService();
    const created = await h.service.create({
      code: 'bundle-a',
      price: 100_000,
      items: [{ type: 'credits', amount: 20 }],
    });
    await expect(h.service.disable(created.id)).resolves.toEqual({
      success: true,
      id: created.id,
      active: false,
    });
    expect(h.rows.get(created.id).active).toBe(false);
  });

  it('returns not found for a missing bundle', async () => {
    const h = makeService();
    await expect(h.service.update(99, { price: 10 })).rejects.toBeInstanceOf(NotFoundException);
  });
});
