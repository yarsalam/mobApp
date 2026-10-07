import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { FilterUsersDto } from '../dto/FilterUsersDto';
import {
  createUserWithMainImageQuery,
  getUserAvatar,
} from '../../helpers/user-query.helper';

@Injectable()
export class UserFilterService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async filterUsers(
    filterDto: FilterUsersDto,
    currentUserId: number,
    page = 0,
    limit = 10,
  ): Promise<User[]> {
    const currentUser = await this.userRepo.findOne({
      where: { id: currentUserId },
    });
    if (!currentUser) {
      throw new NotFoundException('کاربر یافت نشد');
    }
    const oppositeGender = currentUser.gender === 'women' ? 'men' : 'women';

    const query = createUserWithMainImageQuery(this.userRepo)
      .andWhere('user.gender = :oppositeGender', { oppositeGender })
      .andWhere('user.status = :status', { status: 'active' })
      .andWhere('user.id != :myId', { myId: currentUserId });
    console.log('getQueryAndParameters:', query.getQueryAndParameters());
    // فقط ستون‌هایی که واقعاً روی entity وجود دارن
    const arrayFields = [
      'marital',
      'province',
      'city',
      'nationality',
      'education',
      'employment',
      'health',
      'religion',
    ];

    for (const key of arrayFields) {
      const value = filterDto[key];
      if (value && Array.isArray(value) && value.length > 0) {
        query.andWhere(`user.${key} IN (:...${key})`, { [key]: value });
      }
    }

    if (filterDto.minHeight !== undefined) {
      query.andWhere('user.height >= :minHeight', {
        minHeight: +filterDto.minHeight,
      });
    }
    if (filterDto.maxHeight !== undefined) {
      query.andWhere('user.height <= :maxHeight', {
        maxHeight: +filterDto.maxHeight,
      });
    }
    if (filterDto.minWeight !== undefined) {
      query.andWhere('user.weight >= :minWeight', {
        minWeight: +filterDto.minWeight,
      });
    }
    if (filterDto.maxWeight !== undefined) {
      query.andWhere('user.weight <= :maxWeight', {
        maxWeight: +filterDto.maxWeight,
      });
    }

    const currentYear = new Date().getFullYear();
    if (filterDto.minAge !== undefined) {
      const maxBirthYear = currentYear - +filterDto.minAge;
      query.andWhere('user.birth_year <= :maxBirthYear', {
        maxBirthYear: `${maxBirthYear}`,
      });
    }
    if (filterDto.maxAge !== undefined) {
      const minBirthYear = currentYear - +filterDto.maxAge;
      query.andWhere('user.birth_year >= :minBirthYear', {
        minBirthYear: `${minBirthYear}`,
      });
    }

    if (filterDto.hasPhoto) {
      query.andWhere('mainImage.id IS NOT NULL');
    }

    if (filterDto.verifiedOnly) {
      query.andWhere('user.isFaceVerified = :verified', { verified: true });
    }

    query.skip(page * limit).take(limit);

    const users = await query.getMany();
    return users.map((user) => ({
      ...user,
      avatar: getUserAvatar(user),
    }));
  }

  async countFilteredUsers(
    filterDto: FilterUsersDto,
    currentUserId: number,
  ): Promise<number> {
    const currentUser = await this.userRepo.findOne({
      where: { id: currentUserId },
    });
    if (!currentUser) {
      throw new NotFoundException('کاربر یافت نشد');
    }
    const oppositeGender = currentUser.gender === 'women' ? 'men' : 'women';

    const query = createUserWithMainImageQuery(this.userRepo)
      .andWhere('user.gender = :oppositeGender', { oppositeGender })
      .andWhere('user.status = :status', { status: 'active' })
      .andWhere('user.id != :myId', { myId: currentUserId });

    const arrayFields = [
      'marital',
      'province',
      'city',
      'nationality',
      'education',
      'employment',
      'health',
      'religion',
    ];
    for (const key of arrayFields) {
      const value = filterDto[key];
      if (value && Array.isArray(value) && value.length > 0) {
        query.andWhere(`user.${key} IN (:...${key})`, { [key]: value });
      }
    }
    if (filterDto.minHeight)
      query.andWhere('user.height >= :minHeight', {
        minHeight: +filterDto.minHeight,
      });
    if (filterDto.maxHeight)
      query.andWhere('user.height <= :maxHeight', {
        maxHeight: +filterDto.maxHeight,
      });
    if (filterDto.minWeight)
      query.andWhere('user.weight >= :minWeight', {
        minWeight: +filterDto.minWeight,
      });
    if (filterDto.maxWeight)
      query.andWhere('user.weight <= :maxWeight', {
        maxWeight: +filterDto.maxWeight,
      });

    const currentYear = new Date().getFullYear();
    if (filterDto.minAge) {
      const maxBirthYear = currentYear - +filterDto.minAge;
      query.andWhere('user.birth_year <= :maxBirthYear', {
        maxBirthYear: `${maxBirthYear}`,
      });
    }
    if (filterDto.maxAge) {
      const minBirthYear = currentYear - +filterDto.maxAge;
      query.andWhere('user.birth_year >= :minBirthYear', {
        minBirthYear: `${minBirthYear}`,
      });
    }
    if (filterDto.hasPhoto) query.andWhere('mainImage.id IS NOT NULL');
    if (filterDto.verifiedOnly)
      query.andWhere('user.isFaceVerified = :verified', { verified: true });

    return query.getCount();
  }

  async findAllUsersExceptMe(myUserId: number): Promise<User[]> {
    return this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.userImages', 'images')
      .where('user.id != :myUserId', { myUserId })
      .getMany();
  }
}
