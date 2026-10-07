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

  async analyzeTechnicalSEO() {
    try {
      const [psiMobile, psiDesktop, crux, gsc] = await Promise.all([
        this.externalTools.getPageSpeedMetrics(undefined, 'mobile'),
        this.externalTools.getPageSpeedMetrics(undefined, 'desktop'),
        this.externalTools.getCruxData(),
        // FIX: قبلاً getSearchConsoleData(28) بود — پارامتر اول حالا siteUrl است
        this.externalTools.getSearchConsoleData(undefined, 28),
      ]);

      const metrics = {
        // ── Lab metrics (Lighthouse / mobile) ───────────────────────────────
        lcp: psiMobile?.lcp ?? 2.5,
        fid: psiMobile?.fid ?? 100,
        cls: psiMobile?.cls ?? 0.1,
        ttfb: psiMobile?.ttfb ?? 200,
        fcp: psiMobile?.fcp ?? 1.5,

        // ── Scores ──────────────────────────────────────────────────────────
        performanceScore: psiMobile?.performanceScore ?? 0,
        seoScore: psiMobile?.seoScore ?? 0,
        accessibilityScore: psiMobile?.accessibilityScore ?? 0,

        // ── FIX: فیلدهایی که admin-api-seo.controller.ts انتظار دارد ──────
        // mobileScore = همان performanceScore موبایل (0–100)
        mobileScore: psiMobile?.mobileScore ?? psiMobile?.performanceScore ?? 0,
        // crawlErrors و brokenLinks از GSC/API جداگانه — فعلاً placeholder صفر
        crawlErrors: gsc?.crawlErrors ?? 0,
        brokenLinks: gsc?.brokenLinks ?? 0,

        // ── Desktop ─────────────────────────────────────────────────────────
        desktopLcp: psiDesktop?.lcp ?? 0,
        desktopCls: psiDesktop?.cls ?? 0,
        desktopScore: psiDesktop?.performanceScore ?? 0,

        // ── Field data (CrUX — داده واقعی Chrome) ───────────────────────────
        fieldLcp: crux?.lcp?.p75 ?? null,
        fieldInp: crux?.inp?.p75 ?? null,
        fieldCls: crux?.cls?.p75 ?? null,
        fieldTtfb: crux?.ttfb?.p75 ?? null,

        // ── Opportunities ───────────────────────────────────────────────────
        opportunities: psiMobile?.opportunities ?? [],

        // ── Search Console ──────────────────────────────────────────────────
        clicks: gsc?.totalClicks ?? 0,
        impressions: gsc?.totalImpressions ?? 0,
        avgCTR: gsc?.avgCTR ?? 0,
        avgPosition: gsc?.avgPosition ?? 0,
        topQueries: gsc?.topQueries ?? [],

        timestamp: new Date(),
      };

      await this.metricsRepo.save({
        metricDate: new Date(),
        type: 'technical',
        data: metrics,
        score: this.calculateTechnicalScore(metrics),
      });

      return metrics;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Technical SEO analysis failed: ${message}`);
      return null;
    }
  }

  async notifyNewContent(
    urls: string[],
  ): Promise<{ success: number; failed: number }> {
    return this.externalTools.batchRequestIndexing(urls);
  }

  private calculateTechnicalScore(metrics: any): number {
    let score = 100;

    if (metrics.lcp > 4) score -= 20;
    else if (metrics.lcp > 2.5) score -= 10;

    if (metrics.cls > 0.25) score -= 15;
    else if (metrics.cls > 0.1) score -= 8;

    if (metrics.ttfb > 1800) score -= 10;
    else if (metrics.ttfb > 800) score -= 5;

    if (metrics.fieldLcp !== null) {
      if (metrics.fieldLcp > 4) score -= 15;
      else if (metrics.fieldLcp > 2.5) score -= 8;
    }

    if (metrics.fieldInp !== null) {
      if (metrics.fieldInp > 500) score -= 10;
      else if (metrics.fieldInp > 200) score -= 5;
    }

    if (metrics.crawlErrors > 10) score -= metrics.crawlErrors * 2;
    if (metrics.brokenLinks > 0) score -= metrics.brokenLinks * 5;

    return Math.max(0, Math.min(100, score));
  }
}
