import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { CompetitorData } from '../entities/competitor-data.entity';
import { HttpService } from '@nestjs/axios';

interface CompetitorChange {
  competitor: string;
  newKeywords: any[];
  newBacklinks: number;
  alert: string;
}

@Injectable()
export class CompetitorSEOService {
  private readonly logger = new Logger(CompetitorSEOService.name);

  constructor(
    @InjectRepository(CompetitorData)
    private readonly competitorRepo: Repository<CompetitorData>,
    private readonly httpService: HttpService,
  ) {}

  async analyzeCompetitors() {
    try {
      // TODO: دریافت از APIهای خارجی
      const competitors = await this.getCompetitorData();

      // ذخیره در دیتابیس
      for (const comp of competitors) {
        await this.competitorRepo.save({
          name: comp.name,
          domain: comp.domain,
          date: new Date(),
          traffic: comp.traffic,
          backlinks: comp.backlinks,
          social: comp.social,
        });
      }

      // تحلیل تهدید
      const threats = this.calculateThreats(competitors);

      // پیدا کردن فرصت‌ها
      const opportunities = this.findOpportunities(competitors);

      return {
        competitors,
        threats,
        opportunities,
        timestamp: new Date(),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Competitor analysis failed: ${message}`);
      return this.getMockCompetitorData();
    }
  }

  private async getCompetitorData() {
    // TODO: اتصال به SimilarWeb یا RivalOut
    return this.getMockCompetitorData().competitors;
  }

  private calculateThreats(competitors: any[]) {
    return competitors.map((c) => ({
      name: c.name,
      threatLevel:
        c.traffic.monthlyVisits > 10000
          ? 'high'
          : c.traffic.monthlyVisits > 5000
            ? 'medium'
            : 'low',
      growth: c.traffic.growth || 0,
    }));
  }

  private findOpportunities(competitors: any[]) {
    // پیدا کردن کلمات کلیدی که رقبا دارند ولی ما نداریم
    const allKeywords = competitors.flatMap(
      (c) => c.traffic.topKeywords?.map((k) => k.keyword) || [],
    );

    // TODO: مقایسه با کلمات کلیدی خودمون
    return {
      missingKeywords: allKeywords.slice(0, 10),
      backlinkOpportunities: competitors.flatMap((c) =>
        c.backlinks.referringDomains > 100 ? [c.domain] : [],
      ),
    };
  }

  private getMockCompetitorData() {
    return {
      competitors: [
        {
          name: 'همدم',
          domain: 'hamdam.com',
          traffic: {
            monthlyVisits: 25000,
            trafficSources: {
              direct: 40,
              search: 35,
              social: 15,
              referral: 10,
            },
            topKeywords: [
              { keyword: 'همسریابی', position: 5, traffic: 5000 },
              { keyword: 'ازدواج آسان', position: 8, traffic: 3000 },
            ],
          },
          backlinks: {
            total: 3450,
            referringDomains: 187,
            newLinks: 45,
            lostLinks: 12,
          },
          social: {
            instagram: { followers: 15000, growth: 0.15 },
            telegram: { members: 8000, growth: 0.08 },
          },
        },
        {
          name: 'همسان',
          domain: 'hamsan.com',
          traffic: {
            monthlyVisits: 18000,
            trafficSources: {
              direct: 30,
              search: 45,
              social: 15,
              referral: 10,
            },
            topKeywords: [
              { keyword: 'دوستیابی', position: 6, traffic: 4000 },
              { keyword: 'همدم', position: 10, traffic: 2000 },
            ],
          },
          backlinks: {
            total: 2100,
            referringDomains: 124,
            newLinks: 23,
            lostLinks: 8,
          },
          social: {
            instagram: { followers: 8000, growth: 0.12 },
          },
        },
      ],
      threats: [
        { name: 'همدم', threatLevel: 'high', growth: 0.15 },
        { name: 'همسان', threatLevel: 'medium', growth: 0.12 },
      ],
      opportunities: {
        missingKeywords: ['همسریابی آنلاین', 'ازدواج اینترنتی', 'همدم یابی'],
        backlinkOpportunities: ['digiato.com', 'zoomit.ir'],
      },
    };
  }

  async detectCompetitorChanges(): Promise<any> {
    const competitors = await this.competitorRepo.find({
      order: { createdAt: 'DESC' },
      take: 10,
    });

    const changes: CompetitorChange[] = [];
    for (const comp of competitors) {
      // مقایسه با داده‌های قبلی (می‌توانید یک snapshot قبلی نگه دارید)
      const prevData = await this.competitorRepo.findOne({
        where: { domain: comp.domain, date: LessThan(comp.date) },
      });

      if (prevData) {
        const newKeywords = comp.traffic.topKeywords.filter(
          (kw) =>
            !prevData.traffic.topKeywords.find((p) => p.keyword === kw.keyword),
        );
        const newBacklinks = comp.backlinks.total - prevData.backlinks.total;

        if (newKeywords.length > 0 || newBacklinks > 10) {
          changes.push({
            competitor: comp.name,
            newKeywords,
            newBacklinks,
            alert: `🚨 ${comp.name} ${newKeywords.length} کلمه کلیدی جدید و ${newBacklinks} بک‌لینک جدید کسب کرده است.`,
          });
        }
      }
    }

    return changes;
  }
}
