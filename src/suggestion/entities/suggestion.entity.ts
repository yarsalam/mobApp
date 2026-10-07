import { User } from 'src/users/entities/user.entity';

export class SuggestionEntity {
  id: number;
  nickname: string;
  age: number;
  city?: string;
  gender?: string;
  avatar?: string | null;
  hobbies?: string[];
  values?: string[];
  compatibilityScore?: number;
  isOnline?: boolean;
  fullData?: any;

  static fromUser(user: User, score = 0, fullData?: any): SuggestionEntity {
    const e = new SuggestionEntity();
    e.id = user.id;
    e.nickname = user.nickname;
    e.age = this.calculateAge(user);
    e.city = user.city;
    e.hobbies = user.hobbies_self ?? [];
    e.values = user.values_self ?? [];
    e.gender = user.gender;
    e.compatibilityScore = Math.round(score);
    e.isOnline = user.devices?.some((d) => d.isOnline) ?? false;
    // 🔥 افزودن avatar
    const mainImage =
      user.userImages?.find((img) => img.isMain) || user.userImages?.[0];
    e.avatar = mainImage?.url || null;
    if (fullData) e.fullData = fullData;
    return e;
  }

  private static calculateAge(
    user: Pick<User, 'birth_year' | 'birth_month' | 'birth_day'>,
  ): number {
    const y = Number(user.birth_year);
    if (!y) return 0;

    // تبدیل سال شمسی به میلادی: سال میلادی ≈ سال شمسی + 621
    const gregorianYear = y + 621;
    const m = user.birth_month ? Number(user.birth_month) : 1;
    const d = user.birth_day ? Number(user.birth_day) : 1;

    const today = new Date();
    const birthDate = new Date(gregorianYear, m - 1, d);
    let age = today.getFullYear() - birthDate.getFullYear();

    // تنظیم دقیق بر اساس ماه و روز
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birthDate.getDate())
    ) {
      age--;
    }

    return age;
  }
}
