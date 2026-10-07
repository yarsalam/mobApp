import { Injectable } from '@nestjs/common';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';

import { FilterUsersDto } from './dto/FilterUsersDto';
import { UserCrudService } from './crud/user-crud.service';
import { UserFilterService } from './filter/user-filter.service';
import { UserAccountService } from './account/user-account.service';
import { UserDiscoveryService } from './discovery/user-discovery.service';
import { UserSimilarityService } from './similarity/user-similarity.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly filter: UserFilterService,
    private readonly account: UserAccountService,
    private readonly discovery: UserDiscoveryService,
    private readonly similarity: UserSimilarityService,
    private readonly crud: UserCrudService,
  ) {}

  // Delegate to crud
  async findById(id: number) {
    return this.crud.findById(id);
  }

  async findByPhone(phone: string) {
    return this.crud.findByPhone(phone);
  }

  async create(createUserDto: CreateUserDto) {
    return this.crud.create(createUserDto);
  }

  async update(id: number, updateUserDto: Record<string, any>) {
    return this.crud.update(id, updateUserDto);
  }

  async updateDirect(id: number, dto: Record<string, any>): Promise<void> {
    return this.crud.updateDirect(id, dto);
  }

  async findFullProfile(id: number) {
    return this.crud.findFullProfile(id);
  }

  async filterUsers(
    filterDto: FilterUsersDto,
    currentUserId: number,
    page = 0,
    limit = 10,
  ) {
    return this.filter.filterUsers(filterDto, currentUserId, page, limit);
  }

  async countFilteredUsers(filterDto: FilterUsersDto, currentUserId: number) {
    return this.filter.countFilteredUsers(filterDto, currentUserId);
  }

  async findAllUsersExceptMe(myUserId: number) {
    return this.filter.findAllUsersExceptMe(myUserId);
  }

  // Delegate to account
  async suspendAccount(userId: number) {
    return this.account.suspendAccount(userId);
  }

  async resignAccount(userId: number) {
    return this.account.resignAccount(userId);
  }

  // Delegate to discovery
  async exploreUsers(
    requestingUserId: number | null,
    page: number,
    limit: number,
  ) {
    return this.discovery.exploreUsers(requestingUserId, page, limit);
  }

  // Delegate to similarity
  async findRecentSimilarUsers(userId: number, limit: number, daysAgo: number) {
    return this.similarity.findRecentSimilarUsers(userId, limit, daysAgo);
  }

  async findByIds(ids: number[], options?: any): Promise<User[]> {
    return this.crud.findByIds(ids, options);
  }
}
