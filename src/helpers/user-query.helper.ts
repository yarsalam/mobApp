import { User } from 'src/users/entities/user.entity';
import { Repository, SelectQueryBuilder } from 'typeorm';

export function createUserWithMainImageQuery(
  userRepository: Repository<User>,
): SelectQueryBuilder<User> {
  return userRepository
    .createQueryBuilder('user')
    .leftJoinAndSelect(
      'user.userImages',
      'mainImage',
      'mainImage.isMain = :isMain',
      { isMain: true },
    );
}

export function getUserAvatar(user: User): string {
  const mainImage = user.userImages?.find((img) => img.isMain);
  if (mainImage) {
    return `/images/users/100/${mainImage.filename}`;
  }

  // آواتار پیش‌فرض بر اساس جنسیت
  return user.gender === 'women'
    ? '/images/defaults/avatar-woman.jpg'
    : '/images/defaults/avatar-man.png';
}
