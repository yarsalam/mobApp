export function computePersonalityScore(sentiments, emotions) {
  // هر منطق ساده‌ای خواستی
  return (sentiments.score + emotions.score) / 2;
}
