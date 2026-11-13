export interface AcquisitionTouchInput {
  source?: unknown;
  medium?: unknown;
  campaign?: unknown;
  campaignId?: unknown;
  content?: unknown;
  term?: unknown;
  landingPage?: unknown;
  referrer?: unknown;
  referralCode?: unknown;
  capturedAt?: unknown;
}

export interface NormalizedAcquisitionTouch {
  source: string;
  medium: string | null;
  campaign: string | null;
  campaignId: string | null;
  content: string | null;
  term: string | null;
  landingPage: string | null;
  referrer: string | null;
  referralCode: string | null;
  capturedAt: string;
  confidence: 'explicit_utm' | 'referral' | 'referrer' | 'unattributed';
}

const TOKEN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const ALIASES: Record<string, string> = {
  google: 'google_organic',
  google_search: 'google_organic',
  google_ads: 'google_ads',
  adwords: 'google_ads',
  instagram: 'instagram',
  ig: 'instagram',
  telegram: 'telegram',
  t_me: 'telegram',
  whatsapp: 'whatsapp',
  bale: 'bale',
  linkedin: 'linkedin',
  youtube: 'youtube',
  tiktok: 'tiktok',
  facebook: 'facebook',
  meta: 'facebook',
  x: 'x',
  twitter: 'x',
  chatgpt: 'chatgpt_search',
  openai: 'chatgpt_search',
  perplexity: 'perplexity',
  copilot: 'copilot',
  gemini: 'gemini',
  claude: 'claude',
  referral: 'referral',
  partner: 'partner',
  email: 'email',
  sms: 'sms',
  direct: 'direct',
  mobile: 'unattributed',
  app: 'unattributed',
  unattributed: 'unattributed',
};

function cleanString(value: unknown, maxLength = 160): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLength);
  return cleaned.length ? cleaned : null;
}

function cleanToken(value: unknown): string | null {
  const cleaned = cleanString(value, 80)?.toLowerCase().replace(/\s+/g, '_');
  if (!cleaned || !TOKEN.test(cleaned)) return null;
  return ALIASES[cleaned] ?? cleaned;
}

function hostFromUrl(value: unknown): string | null {
  const raw = cleanString(value, 2048);
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function safeLandingPage(value: unknown): string | null {
  const raw = cleanString(value, 2048);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    // Query strings and fragments may contain personal or session information.
    return `${url.origin}${url.pathname.slice(0, 500)}`.slice(0, 600);
  } catch {
    // Permit an app route, not a full untrusted URL.
    return raw.startsWith('/') ? raw.split(/[?#]/, 1)[0].slice(0, 300) : null;
  }
}

function classifyReferrer(referrer: unknown): string | null {
  const host = hostFromUrl(referrer);
  if (!host) return null;
  if (host === 'chatgpt.com' || host === 'chat.openai.com') return 'chatgpt_search';
  if (host === 'perplexity.ai' || host.endsWith('.perplexity.ai')) return 'perplexity';
  if (host === 'copilot.microsoft.com') return 'copilot';
  if (host === 'gemini.google.com') return 'gemini';
  if (host === 'claude.ai' || host.endsWith('.claude.ai')) return 'claude';
  if (host === 'google.com' || host.endsWith('.google.com')) return 'google_organic';
  if (host === 'bing.com' || host.endsWith('.bing.com')) return 'bing_organic';
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram';
  if (host === 't.me' || host === 'telegram.me' || host.endsWith('.telegram.org')) return 'telegram';
  if (host === 'whatsapp.com' || host.endsWith('.whatsapp.com')) return 'whatsapp';
  if (host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')) return 'youtube';
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return 'linkedin';
  if (host === 'facebook.com' || host.endsWith('.facebook.com')) return 'facebook';
  if (host === 'x.com' || host === 'twitter.com') return 'x';
  if (host === 'bale.ai' || host.endsWith('.bale.ai')) return 'bale';
  return 'referral';
}

/**
 * Normalize a client-supplied touch without trusting it as an authenticated
 * source. Only source labels and safe URL components are retained; no click IDs,
 * cookies, IP addresses, user agents or query-string values are persisted.
 */
export function normalizeAcquisitionTouch(
  input: AcquisitionTouchInput | null | undefined,
  fallback: { source?: unknown; term?: unknown; referrer?: unknown } = {},
  now = new Date(),
): NormalizedAcquisitionTouch {
  const referralCode = cleanString(input?.referralCode, 96);
  const explicitSource = cleanToken(input?.source ?? fallback.source);
  const medium = cleanToken(input?.medium);
  const referrer = hostFromUrl(input?.referrer ?? fallback.referrer);
  let source = explicitSource;
  let confidence: NormalizedAcquisitionTouch['confidence'] = explicitSource
    ? 'explicit_utm'
    : 'unattributed';

  if (referralCode) {
    source = 'referral';
    confidence = 'referral';
  } else if (!source || source === 'unattributed') {
    source = classifyReferrer(input?.referrer ?? fallback.referrer) ?? 'unattributed';
    confidence = source === 'unattributed' ? 'unattributed' : 'referrer';
  }

  if (source === 'google_organic' && ['cpc', 'ppc', 'paid', 'paid_search'].includes(medium ?? '')) {
    source = 'google_ads';
  }

  const capturedRaw = cleanString(input?.capturedAt, 64);
  const capturedDate = capturedRaw ? new Date(capturedRaw) : now;
  const capturedAt =
    Number.isFinite(capturedDate.getTime()) && capturedDate.getTime() <= now.getTime() + 300_000
      ? capturedDate.toISOString()
      : now.toISOString();

  return {
    source: source ?? 'unattributed',
    medium,
    campaign: cleanString(input?.campaign, 160),
    campaignId: cleanString(input?.campaignId, 120),
    content: cleanString(input?.content, 160),
    term: cleanString(input?.term ?? fallback.term, 160),
    landingPage: safeLandingPage(input?.landingPage),
    referrer,
    referralCode,
    capturedAt,
    confidence,
  };
}

export function acquisitionTouchFromUserMetadata(
  acquisitionSource: unknown,
  metadata: unknown,
): NormalizedAcquisitionTouch {
  const meta = metadata && typeof metadata === 'object'
    ? (metadata as Record<string, unknown>)
    : {};
  const acquisition = meta.acquisition && typeof meta.acquisition === 'object'
    ? (meta.acquisition as Record<string, unknown>)
    : {};
  const firstTouch = acquisition.firstTouch && typeof acquisition.firstTouch === 'object'
    ? (acquisition.firstTouch as AcquisitionTouchInput)
    : null;
  const legacyMeta = meta.acquisitionMeta && typeof meta.acquisitionMeta === 'object'
    ? (meta.acquisitionMeta as Record<string, unknown>)
    : {};
  return normalizeAcquisitionTouch(
    firstTouch ?? {
      source: acquisitionSource ?? meta.acquisitionSource,
      medium: legacyMeta.medium,
      campaign: legacyMeta.campaign,
      landingPage: legacyMeta.landingPage,
      referrer: legacyMeta.referrer,
      term: meta.acquisitionKeyword,
      referralCode: meta.referralCode,
    },
    {
      source: acquisitionSource ?? meta.acquisitionSource,
      term: meta.acquisitionKeyword,
      referrer: legacyMeta.referrer,
    },
  );
}
