import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SEOMetrics } from '../entities/seo-metrics.entity';
import { ExternalSEOToolsService } from './external-seo-tools.service';

@Injectable()
export class TechnicalSEOService {
  private readonly logger = new Logger(TechnicalSEOService.name);

  constructor(
    @InjectRepository(SEOMetrics)
    private readonly metricsRepo: Repository<SEOMetrics>,
    private readonly externalTools: ExternalSEOToolsService,
  ) {}

  async analyzeTechnicalSEO(): Promise<{
    dataAvailable: boolean;
    sources?: Record<string, string>;
    [key: string]: any;
  }> {
    try {
      const [psiMobile, psiDesktop, crux, gsc] = await Promise.all([
        this.externalTools.getPageSpeedMetrics(undefined, 'mobile'),
        this.externalTools.getPageSpeedMetrics(undefined, 'desktop'),
        this.externalTools.getCruxData(),
        this.externalTools.getSearchConsoleData(undefined, 28),
      ]);

      const metrics = {
        dataAvailable: Boolean(
          psiMobile?.dataAvailable ||
          psiDesktop?.dataAvailable ||
          crux ||
          gsc?.dataAvailable,
        ),
        sources: {
          pageSpeedMobile: psiMobile?.dataAvailable ? 'available' : 'unavailable',
          pageSpeedDesktop: psiDesktop?.dataAvailable ? 'available' : 'unavailable',
          chromeUxReport: crux ? 'available' : 'unavailable',
          searchConsole: gsc?.dataAvailable ? 'available' : 'unavailable',
        },
        // Current Core Web Vitals: LCP, INP and CLS. FID is obsolete.
        lcp: psiMobile?.lcp ?? null,
        inp: psiMobile?.inp ?? psiMobile?.fieldData?.inp?.value ?? null,
        cls: psiMobile?.cls ?? null,
        ttfb: psiMobile?.ttfb ?? null,
        fcp: psiMobile?.fcp ?? null,
        performanceScore: psiMobile?.performanceScore ?? null,
        seoScore: psiMobile?.seoScore ?? null,
        accessibilityScore: psiMobile?.accessibilityScore ?? null,
        mobileScore: psiMobile?.performanceScore ?? null,
        crawlErrors: null,
        brokenLinks: null,
        desktopLcp: psiDesktop?.lcp ?? null,
        desktopCls: psiDesktop?.cls ?? null,
        desktopScore: psiDesktop?.performanceScore ?? null,
        fieldLcp: crux?.lcp?.p75 ?? null,
        fieldInp: crux?.inp?.p75 ?? null,
        fieldCls: crux?.cls?.p75 ?? null,
        fieldTtfb: crux?.ttfb?.p75 ?? null,
        opportunities: psiMobile?.opportunities ?? [],
        clicks: gsc?.totalClicks ?? null,
        impressions: gsc?.totalImpressions ?? null,
        avgCTR: gsc?.avgCTR ?? null,
        avgPosition: gsc?.avgPosition ?? null,
        topQueries: gsc?.topQueries ?? [],
        timestamp: new Date(),
      };

      await this.metricsRepo.save({
        metricDate: new Date(),
        type: 'technical',
        data: metrics,
      });

      return metrics;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Technical SEO analysis failed: ' + message);
      return {
        dataAvailable: false,
        status: 'unavailable',
        reason: 'technical_measurement_failed',
        timestamp: new Date(),
      };
    }
  }

  async notifyNewContent(urls: string[]) {
    // Google Indexing API is not a generic indexing endpoint for ordinary pages.
    return {
      success: 0,
      failed: urls.length,
      status: 'not_supported_for_general_pages',
      reason: 'Use sitemap discovery and Search Console for ordinary website pages.',
    };
  }
}
