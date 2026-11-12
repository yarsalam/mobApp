import { Injectable } from '@nestjs/common';

export interface ContentIdea {
  id: string;
  title: string;
  type: 'product_capability' | 'research_topic';
  keywords: string[];
  estimatedTraffic: null;
  priority: 'product_pillar';
  source: 'product_capability_registry';
  capabilityStatus: 'partial' | 'not_implemented';
  promotionAllowed: false;
  evidenceRequired: string[];
}

/**
 * Marketing ideas are derived from the product roadmap, not private user
 * profile data, hard-coded audience statistics, or fabricated traffic.
 * Every item remains non-promotable until its capability is implemented
 * and its end-to-end acceptance evidence is recorded.
 */
@Injectable()
export class ContentOpportunityService {
  private readonly productPillars: ContentIdea[] = [
    {
      id: 'ai-self-presentation',
      title: 'هوش مصنوعی از متن معرفی تو چه برداشتی می‌کند؟',
      type: 'product_capability',
      keywords: [],
      estimatedTraffic: null,
      priority: 'product_pillar',
      source: 'product_capability_registry',
      capabilityStatus: 'partial',
      promotionAllowed: false,
      evidenceRequired: [
        'Dedicated profile analysis endpoint',
        'Clarity and ambiguity evaluation tests',
        'Grounded rewrite suggestions with user approval',
        'Privacy and retention acceptance tests',
      ],
    },
    {
      id: 'ai-conversation-copilot',
      title: 'هوش مصنوعی چگونه می‌تواند به ادامه یک گفت‌وگوی بهتر کمک کند؟',
      type: 'product_capability',
      keywords: [],
      estimatedTraffic: null,
      priority: 'product_pillar',
      source: 'product_capability_registry',
      capabilityStatus: 'partial',
      promotionAllowed: false,
      evidenceRequired: [
        'Verified chat ownership and participant consent',
        'End-to-end mobile integration of reply suggestions',
        'Context and prompt-injection regression tests',
      ],
    },
    {
      id: 'ai-communication-safety',
      title: 'قبل از ارسال پیام، ابهام و لحن آن را بررسی کن',
      type: 'product_capability',
      keywords: [],
      estimatedTraffic: null,
      priority: 'product_pillar',
      source: 'product_capability_registry',
      capabilityStatus: 'partial',
      promotionAllowed: false,
      evidenceRequired: [
        'Persian and Finglish moderation benchmark',
        'Fail-closed runtime acceptance',
        'Respectful rewrite endpoint and user-controlled confirmation',
      ],
    },
    {
      id: 'explainable-matching',
      title: 'هوش مصنوعی چرا این دو پروفایل را به هم نزدیک می‌بیند؟',
      type: 'product_capability',
      keywords: [],
      estimatedTraffic: null,
      priority: 'product_pillar',
      source: 'product_capability_registry',
      capabilityStatus: 'partial',
      promotionAllowed: false,
      evidenceRequired: [
        'Feature-level evidence from the active matching engine',
        'User-visible explanation tests',
        'No fabricated compatibility or relationship-success probability',
      ],
    },
    {
      id: 'ai-audience-intelligence',
      title: 'هوش جمعی چگونه تغییر نیازها و علایق جامعه را آشکار می‌کند؟',
      type: 'research_topic',
      keywords: [],
      estimatedTraffic: null,
      priority: 'product_pillar',
      source: 'product_capability_registry',
      capabilityStatus: 'not_implemented',
      promotionAllowed: false,
      evidenceRequired: [
        'Purpose limitation and lawful processing review',
        'Privacy-preserving aggregation and minimum cohort thresholds',
        'Re-identification and sensitive-data leakage tests',
      ],
    },
  ];

  generateContentIdeas(): ContentIdea[] {
    return this.productPillars.map((idea) => ({
      ...idea,
      keywords: [...idea.keywords],
      evidenceRequired: [...idea.evidenceRequired],
    }));
  }

  generateHighIntentContent(): ContentIdea[] {
    // Legacy admin route retained for compatibility; "high intent" is not
    // inferred from private profile attributes or fabricated LTV estimates.
    return this.generateContentIdeas();
  }
}
