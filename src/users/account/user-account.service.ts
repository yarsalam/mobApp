import { Injectable, NotFoundException } from '@nestjs/common';
import { User } from '../entities/user.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { UserEventService } from 'src/user-event/user-event.service';
import { EventType } from 'src/user-event/type/event-type.enum';

@Injectable()
export class UserAccountService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,

    private readonly userEventService: UserEventService,
  ) {}

  //   async findByIds(
  //     ids: number[],
  //     options?: {
  //       relations?: string[];
  //       select?: (keyof User)[];
  //     },
  //   ): Promise<User[]> {
  //     if (!ids || ids.length === 0) {
  //       return [];
  //     }

  //     return this.userRepository.find({
  //       where: { id: In(ids) },
  //       relations: options?.relations || [],
  //       select: options?.select,
  //     });
  //   }

  async findById(id: number): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['userImages'], // این مهمه
    });
    if (!user) {
      throw new NotFoundException('کاربر یافت نشد');
    }
    return user;
  }

  async suspendAccount(userId: number): Promise<User> {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('کاربر یافت نشد');

    user.status = 'suspended';
    await this.userEventService.log({
      userId,
      type: EventType.ACCOUNT_DEACTIVATE,
      metadata: { action: 'suspend' },
    });
    return this.userRepository.save(user);
  }

  async resignAccount(userId: number): Promise<User> {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('کاربر یافت نشد');

    user.status = 'resigned';
    await this.userEventService.log({
      userId,
      type: EventType.ACCOUNT_DELETE_REQUEST,
      metadata: { action: 'resign' },
    });
    return this.userRepository.save(user);
  }
}
