export type Gender = 'men' | 'women';

export function getTargetGender(userGender: string | null | undefined): Gender {
  return userGender === 'women' ? 'men' : 'women';
}
