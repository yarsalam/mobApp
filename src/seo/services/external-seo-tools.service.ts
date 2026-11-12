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
    const site = siteUrl ?? this.defaultSite;
    if (!site) {
      return { dataAvailable: false, source: 'unavailable', reason: 'search_console_site_not_configured', rows: [], totalClicks: null, totalImpressions: null, avgCTR: null, avgPosition: null, topQueries: [] };
    }

    const normalizedSite = site.startsWith('http')
      ? (site.endsWith('/') ? site : site + '/')
      : 'https://' + (site.endsWith('/') ? site : site + '/');
    const cacheKey = 'gsc:v2:' + normalizedSite + ':' + days;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const token = await this._getGoogleToken([
      'https://www.googleapis.com/auth/webmasters.readonly',
    ]);
    if (!token) {
      return { dataAvailable: false, source: 'unavailable', reason: 'google_service_account_not_configured', rows: [], totalClicks: null, totalImpressions: null, avgCTR: null, avgPosition: null, topQueries: [] };
    }

    try {
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - days * 86_400_000).toISOString().split('T')[0];
      const { data } = await firstValueFrom(
        this.httpService.post(
          'https://searchconsole.googleapis.com/webmasters/v3/sites/' +
            encodeURIComponent(normalizedSite) +
            '/searchAnalytics/query',
          { startDate, endDate, dimensions: ['query', 'page'], rowLimit: 100, dataState: 'all' },
          { headers: { Authorization: 'Bearer ' + token }, timeout: 15_000 },
        ),
      );

      const rows: any[] = data.rows ?? [];
      const totalClicks = rows.reduce((sum, row) => sum + Number(row.clicks ?? 0), 0);
      const totalImpressions = rows.reduce((sum, row) => sum + Number(row.impressions ?? 0), 0);
      const result = {
        dataAvailable: true,
        source: 'google_search_console',
        rows,
        totalClicks,
        totalImpressions,
        avgCTR: totalImpressions > 0 ? totalClicks / totalImpressions : null,
        avgPosition: rows.length ? rows.reduce((sum, row) => sum + Number(row.position ?? 0), 0) / rows.length : null,
        topQueries: rows.slice(0, 10).map((row) => row.keys?.[0]).filter(Boolean),
        crawlErrors: null,
        brokenLinks: null,
      };
      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', TTL.SEARCH_CONSOLE);
      return result;
    } catch (error: unknown) {
      this.logger.error('GSC request failed', error instanceof Error ? error.message : String(error));
      return { dataAvailable: false, source: 'unavailable', reason: 'search_console_request_failed', rows: [], totalClicks: null, totalImpressions: null, avgCTR: null, avgPosition: null, topQueries: [] };
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // ANALYTICS 4
  // ══════════════════════════════════════════════════════════════════
  async getAnalyticsData(propertyId?: string, days = 28): Promise<any> {
    const property = propertyId || this.ga4Property;
    if (!property) {
      return { dataAvailable: false, source: 'unavailable', reason: 'ga4_property_not_configured', rows: [] };
    }
    const cacheKey = 'ga4:v2:' + property + ':' + days;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const token = await this._getGoogleToken([
      'https://www.googleapis.com/auth/analytics.readonly',
    ]);
    if (!token) {
      return { dataAvailable: false, source: 'unavailable', reason: 'google_service_account_not_configured', rows: [] };
    }
    try {
      const { data } = await firstValueFrom(
        this.httpService.post(
          'https://analyticsdata.googleapis.com/v1beta/properties/' + property + ':runReport',
          {
            dateRanges: [{ startDate: days + 'daysAgo', endDate: 'today' }],
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
          { headers: { Authorization: 'Bearer ' + token }, timeout: 15_000 },
        ),
      );
      const result = { dataAvailable: true, source: 'google_analytics_4', rows: data.rows ?? [], metadata: data.metadata ?? null };
      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', TTL.ANALYTICS);
      return result;
    } catch (error: unknown) {
      this.logger.error('GA4 request failed', error instanceof Error ? error.message : String(error));
      return { dataAvailable: false, source: 'unavailable', reason: 'ga4_request_failed', rows: [] };
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
    if (!target) {
      return { dataAvailable: false, source: 'unavailable', reason: 'site_url_not_configured', strategy };
    }
    const cacheKey = 'psi:v2:' + strategy + ':' + encodeURIComponent(target);
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    try {
      const params: Record<string, string> = { url: target, strategy };
      const apiKey = process.env.GOOGLE_API_KEY ?? '';
      if (apiKey) params.key = apiKey;
      const { data } = await firstValueFrom(
        this.httpService.get(
          'https://www.googleapis.com/pagespeedonline/v5/runPagespeed',
          { params, timeout: 30_000 },
        ),
      );

      const audits = data.lighthouseResult?.audits ?? {};
      const loading = data.loadingExperience?.metrics ?? {};
      const performanceScore = data.lighthouseResult?.categories?.performance?.score;
      const score = (value: unknown) => typeof value === 'number' ? Math.round(value * 100) : null;
      const metric = (key: string, divisor = 1) => {
        const value = audits[key]?.numericValue;
        return typeof value === 'number' && Number.isFinite(value) ? value / divisor : null;
      };
      const field = (key: string, divisor = 1) => {
        const value = loading[key]?.percentile;
        return typeof value === 'number' && Number.isFinite(value)
          ? { value: value / divisor, category: loading[key]?.category ?? null }
          : null;
      };
      const result = {
        dataAvailable: true,
        source: 'pagespeed_insights',
        lcp: metric('largest-contentful-paint', 1000),
        inp: metric('interaction-to-next-paint'),
        cls: metric('cumulative-layout-shift'),
        ttfb: metric('server-response-time'),
        fcp: metric('first-contentful-paint', 1000),
        performanceScore: score(performanceScore),
        seoScore: score(data.lighthouseResult?.categories?.seo?.score),
        accessibilityScore: score(data.lighthouseResult?.categories?.accessibility?.score),
        fieldData: {
          lcp: field('LARGEST_CONTENTFUL_PAINT_MS', 1000),
          cls: field('CUMULATIVE_LAYOUT_SHIFT_SCORE', 100),
          inp: field('INTERACTION_TO_NEXT_PAINT'),
        },
        opportunities: Object.entries(audits)
          .filter(([, value]: any) => value.score !== null && value.score < 0.9 && value.details?.type === 'opportunity')
          .map(([key, value]: any) => ({ key, title: value.title, savingsMs: value.details?.overallSavingsMs ?? null }))
          .sort((a: any, b: any) => (b.savingsMs ?? 0) - (a.savingsMs ?? 0))
          .slice(0, 5),
        strategy,
        url: target,
        measuredAt: new Date().toISOString(),
      };
      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', TTL.PAGESPEED);
      return result;
    } catch (error: unknown) {
      this.logger.error('PageSpeed request failed', error instanceof Error ? error.message : String(error));
      return { dataAvailable: false, source: 'unavailable', reason: 'pagespeed_request_failed', strategy, url: target, lcp: null, inp: null, cls: null, ttfb: null, fcp: null, performanceScore: null, seoScore: null, accessibilityScore: null, fieldData: null, opportunities: [] };
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
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) {
      return { dataAvailable: false, source: 'unavailable', reason: 'serp_provider_not_configured', position: null, totalResults: null, topDomains: [] };
    }
    const cacheKey = 'serp:v2:' + keyword + ':' + domain;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
    try {
      const { data } = await firstValueFrom(
        this.httpService.post(
          'https://google.serper.dev/search',
          { q: keyword, gl: 'ir', hl: 'fa', num: 20, autocorrect: false },
          { headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' }, timeout: 10_000 },
        ),
      );
      const organic: any[] = data.organic ?? [];
      const index = organic.findIndex((row) => row.link?.includes(domain));
      const result = {
        dataAvailable: true,
        source: 'serper',
        position: index >= 0 ? index + 1 : null,
        totalResults: data.searchInformation?.totalResults ?? null,
        topDomains: organic.slice(0, 5).map((row) => row.link),
        peopleAlsoAsk: (data.peopleAlsoAsk ?? []).slice(0, 5).map((row: any) => row.question),
      };
      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', TTL.SERP);
      return result;
    } catch (error: unknown) {
      this.logger.error('SERP request failed', error instanceof Error ? error.message : String(error));
      return { dataAvailable: false, source: 'unavailable', reason: 'serp_request_failed', position: null, totalResults: null, topDomains: [] };
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
  async getBacklinkData(_domain: string): Promise<any> {
    // Backlink-checker metrics are retired from the Yarsalam growth engine.
    // Avoid silently returning zero-valued mock metrics or making paid requests.
    return {
      dataAvailable: false,
      source: 'retired',
      reason: 'backlink_checker_not_part_of_the_product_growth_strategy',
    };
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

  async getKeywordGap(_domain: string, _competitors: string[]): Promise<any> {
    return {
      dataAvailable: false,
      source: 'retired',
      reason: 'keyword_gap_and_competitor_rank_tracking_not_part_of_the_growth_engine',
    };
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
