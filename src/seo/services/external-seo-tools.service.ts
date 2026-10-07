import { Injectable, Logger, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { REDIS_CLIENT } from 'src/redis/redis.constants';
import { Redis } from 'ioredis';
import googleTrends from 'google-trends-api';

const TTL = {
  SEARCH_CONSOLE: 3_600,
  ANALYTICS: 3_600,
  PAGESPEED: 86_400,
  CRUX: 86_400,
  SERP: 3_600,
  TRENDS: 86_400,
  BACKLINK: 86_400,
  DATAFORSEO: 86_400,
} as const;

@Injectable()
export class ExternalSEOToolsService {
  private readonly logger = new Logger(ExternalSEOToolsService.name);
  private readonly defaultSite: string;
  private readonly ga4Property: string;
  // کش توکن Google OAuth — برای جلوگیری از درخواست توکن تکراری
  private _tokenCache = new Map<string, { token: string; expiry: number }>();

  constructor(
    private readonly httpService: HttpService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.defaultSite = process.env.GOOGLE_SEARCH_CONSOLE_SITE ?? '';
    this.ga4Property = process.env.GA4_PROPERTY_ID ?? '';
  }

  // ══════════════════════════════════════════════════════════════════
  // FIX 1: امضای قبلی: getSearchConsoleData(days?)
  //        امضای جدید: getSearchConsoleData(siteUrl?, days?)
  //        کنترلر از این صدا می‌زد: getSearchConsoleData(domain, 30)
  // ══════════════════════════════════════════════════════════════════
  async getSearchConsoleData(siteUrl?: string, days = 28): Promise<any> {
    const site =
      siteUrl ??
      process.env.GOOGLE_SEARCH_CONSOLE_SITE ??
      'https://yarsalam.top/';
    const cacheKey = `gsc:${site}:${days}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
    const normalizedSite = site.startsWith('http')
      ? site.endsWith('/')
        ? site
        : `${site}/`
      : `https://${site.endsWith('/') ? site : site + '/'}`;
    const token = await this._getGoogleToken([
      'https://www.googleapis.com/auth/webmasters.readonly',
    ]);
    if (!token) {
      this.logger.warn('GSC: No service account — using mock');
      return this._mockSearchConsole();
    }

    try {
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - days * 86_400_000)
        .toISOString()
        .split('T')[0];

      const { data } = await firstValueFrom(
        this.httpService.post(
          `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(normalizedSite)}/searchAnalytics/query`,
          {
            startDate,
            endDate,
            dimensions: ['query', 'page'],
            rowLimit: 100,
            dataState: 'all',
          },
          { headers: { Authorization: `Bearer ${token}` }, timeout: 15_000 },
        ),
      );

      const rows: any[] = data.rows ?? [];

      // FIX 3: درست‌شده — (rows ?? []) به‌جای rows?.reduce + ?? 0 آخر
      const totalClicks = rows.reduce((s, r) => s + (r.clicks ?? 0), 0);
      const totalImpressions = rows.reduce(
        (s, r) => s + (r.impressions ?? 0),
        0,
      );
      const avgCTR = rows.length
        ? rows.reduce((s, r) => s + (r.ctr ?? 0), 0) / rows.length
        : 0;
      const avgPosition = rows.length
        ? rows.reduce((s, r) => s + (r.position ?? 0), 0) / rows.length
        : 0;

      const result = {
        rows,
        totalClicks,
        totalImpressions,
        avgCTR,
        avgPosition,
        topQueries: rows
          .slice(0, 10)
          .map((r: any) => r.keys?.[0])
          .filter(Boolean),
        // FIX 2: اضافه‌کردن فیلدهایی که کنترلر انتظار دارد
        crawlErrors: 0, // GSC URL Inspection API جداگانه است — placeholder
        brokenLinks: 0, // placeholder
        mobileScore: 0, // از PSI می‌آید — اینجا placeholder
      };

      await this.redis.set(
        cacheKey,
        JSON.stringify(result),
        'EX',
        TTL.SEARCH_CONSOLE,
      );
      return result;
    } catch (err: any) {
      this.logger.error('GSC API failed', (err as Error).message);
      return this._mockSearchConsole();
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // ANALYTICS 4
  // ══════════════════════════════════════════════════════════════════
  async getAnalyticsData(propertyId?: string, days = 28): Promise<any> {
    const prop = propertyId || this.ga4Property;
    if (!prop) return this._mockAnalytics();

    const cacheKey = `ga4:${prop}:${days}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const token = await this._getGoogleToken([
      'https://www.googleapis.com/auth/analytics.readonly',
    ]);
    if (!token) {
      this.logger.warn('GA4: No service account — using mock');
      return this._mockAnalytics();
    }

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(
          `https://analyticsdata.googleapis.com/v1beta/properties/${prop}:runReport`,
          {
            dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
            metrics: [
              { name: 'activeUsers' },
              { name: 'newUsers' },
              { name: 'sessions' },
              { name: 'averageSessionDuration' },
              { name: 'bounceRate' },
              { name: 'screenPageViews' },
            ],
            dimensions: [{ name: 'sessionSource' }],
          },
          { headers: { Authorization: `Bearer ${token}` }, timeout: 15_000 },
        ),
      );

      const result = { rows: data.rows ?? [], metadata: data.metadata };
      await this.redis.set(
        cacheKey,
        JSON.stringify(result),
        'EX',
        TTL.ANALYTICS,
      );
      return result;
    } catch (err: unknown) {
      this.logger.error('GA4 API failed', (err as Error).message);
      return this._mockAnalytics();
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // PAGESPEED INSIGHTS — رایگان، ۲۵,۰۰۰ کوئری روزانه
  // FIX 2: فیلدهای از دست رفته (mobileScore, crawlErrors, brokenLinks) اضافه شد
  // ══════════════════════════════════════════════════════════════════
  async getPageSpeedMetrics(
    url?: string,
    strategy: 'mobile' | 'desktop' = 'mobile',
  ): Promise<any> {
    const target = url ?? this.defaultSite ?? process.env.APP_URL ?? '';
    const apiKey = process.env.GOOGLE_API_KEY ?? '';
    const cacheKey = `psi:${strategy}:${encodeURIComponent(target)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    try {
      const params: Record<string, string> = { url: target, strategy };
      if (apiKey) params.key = apiKey;

      const { data } = await firstValueFrom(
        this.httpService.get(
          'https://www.googleapis.com/pagespeedonline/v5/runPagespeed',
          { params, timeout: 30_000 },
        ),
      );

      const audits = data.lighthouseResult?.audits ?? {};
      const le = data.loadingExperience?.metrics ?? {};
      const perfScore =
        data.lighthouseResult?.categories?.performance?.score ?? 0;

      const result = {
        // Lab metrics
        lcp: (audits['largest-contentful-paint']?.numericValue ?? 0) / 1000,
        fid: audits['max-potential-fid']?.numericValue ?? 0,
        cls: audits['cumulative-layout-shift']?.numericValue ?? 0,
        ttfb: audits['server-response-time']?.numericValue ?? 0,
        fcp: (audits['first-contentful-paint']?.numericValue ?? 0) / 1000,

        // Scores (0–100)
        performanceScore: Math.round(perfScore * 100),
        seoScore: Math.round(
          (data.lighthouseResult?.categories?.seo?.score ?? 0) * 100,
        ),
        accessibilityScore: Math.round(
          (data.lighthouseResult?.categories?.accessibility?.score ?? 0) * 100,
        ),

        // FIX 2: فیلدهایی که admin-api-seo.controller انتظار دارد
        mobileScore: strategy === 'mobile' ? Math.round(perfScore * 100) : 0,
        crawlErrors: 0, // placeholder — از GSC URL Inspection جداگانه می‌آید
        brokenLinks: 0, // placeholder

        // Field data (CrUX که Google داخل PSI جاسازی می‌کند)
        fieldData: {
          lcp: le.LARGEST_CONTENTFUL_PAINT_MS
            ? {
                value: le.LARGEST_CONTENTFUL_PAINT_MS.percentile / 1000,
                category: le.LARGEST_CONTENTFUL_PAINT_MS.category,
              }
            : null,
          cls: le.CUMULATIVE_LAYOUT_SHIFT_SCORE
            ? {
                value: le.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100,
                category: le.CUMULATIVE_LAYOUT_SHIFT_SCORE.category,
              }
            : null,
          inp: le.INTERACTION_TO_NEXT_PAINT
            ? {
                value: le.INTERACTION_TO_NEXT_PAINT.percentile,
                category: le.INTERACTION_TO_NEXT_PAINT.category,
              }
            : null,
        },

        opportunities: Object.entries(audits)
          .filter(
            ([, v]: any) =>
              v.score !== null &&
              v.score < 0.9 &&
              v.details?.type === 'opportunity',
          )
          .map(([key, v]: any) => ({
            key,
            title: v.title,
            savingsMs: v.details?.overallSavingsMs ?? 0,
          }))
          .sort((a: any, b: any) => b.savingsMs - a.savingsMs)
          .slice(0, 5),

        strategy,
        url: target,
        measuredAt: new Date().toISOString(),
      };

      await this.redis.set(
        cacheKey,
        JSON.stringify(result),
        'EX',
        TTL.PAGESPEED,
      );
      return result;
    } catch (err: unknown) {
      this.logger.error('PSI failed', (err as Error).message);
      return {
        lcp: 2.5,
        fid: 100,
        cls: 0.1,
        ttfb: 200,
        fcp: 1.5,
        performanceScore: 0,
        seoScore: 0,
        accessibilityScore: 0,
        mobileScore: 0,
        crawlErrors: 0,
        brokenLinks: 0,
        fieldData: null,
        opportunities: [],
        strategy,
        url: target,
      };
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // CrUX API — Chrome User Experience Report (رایگان)
  // ══════════════════════════════════════════════════════════════════
  async getCruxData(url?: string): Promise<any> {
    const target = url ?? this.defaultSite;
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey || !target) return null;

    const cacheKey = `crux:${encodeURIComponent(target)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(
          `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${apiKey}`,
          {
            url: target,
            formFactor: 'PHONE',
            metrics: [
              'first_contentful_paint',
              'largest_contentful_paint',
              'interaction_to_next_paint',
              'cumulative_layout_shift',
              'experimental_time_to_first_byte',
            ],
          },
          { timeout: 10_000 },
        ),
      );

      const m = data.record?.metrics ?? {};
      const extract = (key: string) => ({
        p75: m[key]?.percentiles?.p75 ?? null,
        good: m[key]?.histogram?.[0]?.density ?? null,
        needsImprovement: m[key]?.histogram?.[1]?.density ?? null,
        poor: m[key]?.histogram?.[2]?.density ?? null,
      });

      const result = {
        lcp: extract('largest_contentful_paint'),
        fcp: extract('first_contentful_paint'),
        inp: extract('interaction_to_next_paint'),
        cls: extract('cumulative_layout_shift'),
        ttfb: extract('experimental_time_to_first_byte'),
        collectionPeriod: data.record?.collectionPeriod ?? null,
        url: target,
      };

      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', TTL.CRUX);
      return result;
    } catch (err: unknown) {
      this.logger.warn(
        'CrUX: no data (low traffic or new site)',
        (err as Error).message,
      );
      return null;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // SERP — Serper.dev (جایگزین SerpAPI)
  //        ۲,۵۰۰ کوئری رایگان، بعد $1/1K
  // ══════════════════════════════════════════════════════════════════
  async getLiveSerpRanking(keyword: string, domain: string): Promise<any> {
    const cacheKey = `serp:${keyword}:${domain}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) {
      this.logger.warn('SERPER_API_KEY not set — using mock');
      return this._mockSerpData();
    }

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(
          'https://google.serper.dev/search',
          { q: keyword, gl: 'ir', hl: 'fa', num: 20, autocorrect: false },
          {
            headers: {
              'X-API-KEY': apiKey,
              'Content-Type': 'application/json',
            },
            timeout: 10_000,
          },
        ),
      );

      const organic: any[] = data.organic ?? [];
      const pos = organic.findIndex((r) => r.link?.includes(domain));

      const result = {
        position: pos !== -1 ? pos + 1 : null,
        totalResults: data.searchInformation?.totalResults ?? 0,
        topDomains: organic.slice(0, 5).map((r) => r.link),
        peopleAlsoAsk: (data.peopleAlsoAsk ?? [])
          .slice(0, 5)
          .map((q: any) => q.question),
        source: 'serper',
      };

      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', TTL.SERP);
      return result;
    } catch (err: unknown) {
      this.logger.error('Serper failed', (err as Error).message);
      return this._mockSerpData();
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // GOOGLE INDEXING API — رایگان، فهرست فوری
  // ══════════════════════════════════════════════════════════════════
  async requestIndexing(
    url: string,
    type: 'URL_UPDATED' | 'URL_DELETED' = 'URL_UPDATED',
  ): Promise<boolean> {
    const token = await this._getGoogleToken([
      'https://www.googleapis.com/auth/indexing',
    ]);
    if (!token) {
      this.logger.warn('Indexing API: no service account');
      return false;
    }
    try {
      await firstValueFrom(
        this.httpService.post(
          'https://indexing.googleapis.com/v3/urlNotifications:publish',
          { url, type },
          { headers: { Authorization: `Bearer ${token}` }, timeout: 10_000 },
        ),
      );
      this.logger.log(`Indexing requested: ${url} (${type})`);
      return true;
    } catch (err: unknown) {
      this.logger.error('Indexing API failed', (err as Error).message);
      return false;
    }
  }

  async batchRequestIndexing(
    urls: string[],
  ): Promise<{ success: number; failed: number }> {
    const results = await Promise.allSettled(
      urls.map((u) => this.requestIndexing(u)),
    );
    return {
      success: results.filter((r) => r.status === 'fulfilled' && r.value)
        .length,
      failed: results.filter(
        (r) =>
          r.status === 'rejected' || (r.status === 'fulfilled' && !r.value),
      ).length,
    };
  }

  // ══════════════════════════════════════════════════════════════════
  // DataForSEO — pay-as-you-go, $5 رایگان
  // ══════════════════════════════════════════════════════════════════
  async getBacklinkData(domain: string): Promise<any> {
    const cacheKey = `bl:${domain}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const login = process.env.DATAFORSEO_LOGIN;
    const password = process.env.DATAFORSEO_PASSWORD;
    if (!login || !password) {
      this.logger.warn('DataForSEO creds not set');
      return this._mockBacklinkData();
    }

    try {
      const auth = Buffer.from(`${login}:${password}`).toString('base64');
      const { data } = await firstValueFrom(
        this.httpService.post(
          'https://api.dataforseo.com/v3/backlinks/summary/live',
          [{ target: domain, include_subdomains: true }],
          { headers: { Authorization: `Basic ${auth}` }, timeout: 20_000 },
        ),
      );

      const item = data.tasks?.[0]?.result?.[0] ?? {};
      const result = {
        totalBacklinks: item.total_count ?? 0,
        referringDomains: item.referring_domains ?? 0,
        dofollow: item.total_count ?? 0,
        nofollow: 0,
        topDomains: [],
        domainRank: item.rank ?? 0,
        spamScore: item.backlinks_spam_score ?? 0,
        source: 'dataforseo',
      };

      await this.redis.set(
        cacheKey,
        JSON.stringify(result),
        'EX',
        TTL.BACKLINK,
      );
      return result;
    } catch (err: unknown) {
      this.logger.error('DataForSEO backlink failed', (err as Error).message);
      return this._mockBacklinkData();
    }
  }

  // FIX 4 (feature-store-rvenue): این متد number | null برمی‌گرداند.
  // کد صدازننده باید null را چک کند — مثال در انتهای فایل
  async getKeywordDifficulty(keyword: string): Promise<number | null> {
    const cacheKey = `kd:${keyword}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return parseFloat(cached);

    const login = process.env.DATAFORSEO_LOGIN;
    const password = process.env.DATAFORSEO_PASSWORD;
    if (!login || !password) return null;

    try {
      const auth = Buffer.from(`${login}:${password}`).toString('base64');
      const { data } = await firstValueFrom(
        this.httpService.post(
          'https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_info/live',
          [
            {
              keywords: [keyword],
              language_name: 'Persian',
              location_name: 'Iran',
            },
          ],
          { headers: { Authorization: `Basic ${auth}` }, timeout: 15_000 },
        ),
      );

      const kd: number | null =
        data.tasks?.[0]?.result?.[0]?.items?.[0]?.keyword_difficulty ?? null;
      if (kd !== null) {
        await this.redis.set(cacheKey, String(kd), 'EX', TTL.DATAFORSEO);
      }
      return kd;
    } catch {
      return null;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // Google Trends — رایگان، بدون API Key
  // ══════════════════════════════════════════════════════════════════
  async getGoogleTrends(keyword: string, geo = 'IR'): Promise<any> {
    const cacheKey = `trends:${keyword}:${geo}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    try {
      const results = await googleTrends.interestOverTime({
        keyword,
        geo,
        hl: 'fa',
      });
      const parsed = JSON.parse(results);
      await this.redis.set(cacheKey, JSON.stringify(parsed), 'EX', TTL.TRENDS);
      return parsed;
    } catch (err: unknown) {
      this.logger.error('Google Trends failed', (err as Error).message);
      return null;
    }
  }

  async getKeywordGap(domain: string, competitors: string[]): Promise<any> {
    const keywords = [
      'همسریابی',
      'دوستیابی',
      'ازدواج',
      'اپ همسریابی',
      'سایت ازدواج',
    ];
    const result: Record<string, any> = {};

    for (const kw of keywords) {
      const serp = await this.getLiveSerpRanking(kw, domain);
      result[kw] = { ourPosition: serp?.position ?? null };

      for (const comp of competitors.slice(0, 3)) {
        const compSerp = await this.getLiveSerpRanking(kw, comp);
        result[kw][comp] = compSerp?.position ?? null;
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    return result;
  }

  // ══════════════════════════════════════════════════════════════════
  // FIX 5: Google OAuth — فقط با jsonwebtoken (بدون google-auth-library)
  //        نصب: npm install jsonwebtoken @types/jsonwebtoken
  // ══════════════════════════════════════════════════════════════════
  private async _getGoogleToken(scopes: string[]): Promise<string | null> {
    const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!saJson) return null;

    const scopeKey = scopes.join(' ');
    const cached = this._tokenCache.get(scopeKey);
    if (cached && cached.expiry > Date.now()) return cached.token;

    try {
      const sa = JSON.parse(saJson);
      const now = Math.floor(Date.now() / 1000);

      // JWT مستقیم — نیاز به jsonwebtoken دارد (npm install jsonwebtoken)
      const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
      const claim = {
        iss: sa.client_email,
        scope: scopeKey,
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now,
      };

      const signed = jwt.sign(claim, sa.private_key, { algorithm: 'RS256' });

      const { data } = await firstValueFrom(
        this.httpService.post(
          'https://oauth2.googleapis.com/token',
          new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: signed,
          }).toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10_000,
          },
        ),
      );

      const token: string = data.access_token;
      this._tokenCache.set(scopeKey, {
        token,
        expiry: Date.now() + 55 * 60 * 1000,
      });
      return token;
    } catch (err: unknown) {
      this.logger.error('Google OAuth failed', (err as Error).message);
      return null;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // Mock data
  // ══════════════════════════════════════════════════════════════════
  private _mockSearchConsole() {
    return {
      rows: [],
      totalClicks: 0,
      totalImpressions: 0,
      avgCTR: 0,
      avgPosition: 0,
      topQueries: ['همسریابی', 'دوستیابی', 'ازدواج آسان'],
      crawlErrors: 0,
      brokenLinks: 0,
      mobileScore: 0,
      source: 'mock',
    };
  }

  private _mockAnalytics() {
    return { rows: [], metadata: null, source: 'mock' };
  }

  private _mockSerpData() {
    return { position: null, totalResults: 0, topDomains: [], source: 'mock' };
  }

  private _mockBacklinkData() {
    return {
      totalBacklinks: 0,
      referringDomains: 0,
      dofollow: 0,
      nofollow: 0,
      topDomains: [],
      source: 'mock',
    };
  }

  // ══════════════════════════════════════════════════════════════════
  // متدهای deprecated — حفظ سازگاری با کدهای قدیمی
  // ══════════════════════════════════════════════════════════════════
  async getMozData(_domain: string) {
    return null;
  }
  async getSemrushData(_domain: string) {
    return null;
  }
  async getBacklinkWatchData(domain: string) {
    return this.getBacklinkData(domain);
  }
  async getRivalSeeData(_domain: string) {
    return null;
  }
  async getApparkData(_appName: string) {
    return null;
  }
  async getDeepSeekRankings(_keyword: string) {
    return null;
  }
  async analyzeContent(_url: string) {
    return null;
  }
}
