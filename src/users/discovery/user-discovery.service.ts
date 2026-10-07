import { Injectable } from '@nestjs/common';
import { User } from '../entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FindCandidatesOptions } from 'src/types/find-candidates-options.interface';
import { getTargetGender } from 'src/common/utils/gender.util';

@Injectable()
export class UserDiscoveryService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  private getDateFromAge(age: number): Date {
    const today = new Date();
    return new Date(
      today.getFullYear() - age,
      today.getMonth(),
      today.getDate(),
    );
  }

  async exploreUsers(
    requestingUserId: number | null,
    page: number = 0,
    limit: number = 10,
  ): Promise<User[]> {
    const query = this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.userImages', 'images')
      .where('user.isCompleted = true')
      .andWhere('user.status = :status', { status: 'active' })
      .orderBy('RAND()')
      .skip(page * limit)
      .take(limit);

    if (requestingUserId !== null) {
      // ← مستقیم از repo می‌خونیم، نه از UsersService
      const currentUser = await this.userRepository.findOne({
        where: { id: requestingUserId },
        select: ['id', 'gender'],
      });
      const targetGender = getTargetGender(currentUser?.gender);
      query.andWhere('user.gender = :gender', { gender: targetGender });
      query.andWhere('user.id != :id', { id: requestingUserId });
    }

    return query.getMany();
  }

  async findSeedProfiles(
    requestingUserId: number | null,
    options?: { limit?: number; city?: string },
  ) {
    const query = this.userRepository
      .createQueryBuilder('user')
      .where('user.isCompleted = true')
      .andWhere('user.status = :status', { status: 'active' });

    if (requestingUserId !== null) {
      const currentUser = await this.userRepository.findOne({
        where: { id: requestingUserId },
        select: ['id', 'gender'],
      });
      const targetGender = getTargetGender(currentUser?.gender);
      query.andWhere('user.gender = :gender', { gender: targetGender });
      query.andWhere('user.id != :id', { id: requestingUserId });
    }

    if (options?.city)
      query.andWhere('user.city = :city', { city: options.city });

    return query
      .orderBy('RAND()')
      .limit(options?.limit ?? 10)
      .getMany();
  }

  findCandidates(options: FindCandidatesOptions) {
    const query = this.userRepository
      .createQueryBuilder('user')
      .where('user.status = :status', { status: 'active' });

    if (options.excludeUserId) {
      query.andWhere('user.id != :id', { id: options.excludeUserId });
    }

    if (options.gender) {
      query.andWhere('user.gender = :gender', { gender: options.gender });
    }

    if (options.city) {
      query.andWhere('user.city = :city', { city: options.city });
    }

    if (options.ageFrom) {
      query.andWhere(
        "CONCAT(user.birth_year,'-',user.birth_month,'-',user.birth_day) <= :fromDate",
        { fromDate: this.getDateFromAge(options.ageFrom) },
      );
    }

    if (options.ageTo) {
      query.andWhere(
        "CONCAT(user.birth_year,'-',user.birth_month,'-',user.birth_day) >= :toDate",
        { toDate: this.getDateFromAge(options.ageTo) },
      );
    }

    if (options.onlyCompleted) {
      query.andWhere('user.isCompleted = true');
    }

    // فقط آنلاین‌ها
    if (options.onlyOnline) {
      query.andWhere('user.isOnline = true');
    }

    return query.getMany();
  }
}
