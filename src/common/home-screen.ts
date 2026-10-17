export type HomeScreenBanner = {
  id: string;
  kicker: string;
  headline: string;
  title: string;
  sub: string;
  color: string;
  opens: 'express' | 'cook';
};

export type HomeScreenTrust = { icon: string; label: string };
export type HomeScreenStep = { n: string; title: string; body: string };

/**
 * A top tab on the customer home (Swiggy-style). `categoryIds` pins home categories to the tab;
 * when empty, categories are matched by the tab id's default keywords (see TAB_MATCHERS).
 */
export type HomeScreenTab = {
  id: string;
  label: string;
  icon: string;
  color: string;
  categoryIds: string[];
};

export type HomeScreenConfig = {
  searchPlaceholder: string;
  gridTitle: string;
  tabs: HomeScreenTab[];
  banners: HomeScreenBanner[];
  trust: HomeScreenTrust[];
  howTitle: string;
  howSteps: HomeScreenStep[];
  bottomTitle: string;
  bottomSub: string;
  bottomButton: string;
};

export const DEFAULT_HOME_SCREEN: HomeScreenConfig = {
  searchPlaceholder: 'Search kitchen, bathroom, laundry…',
  gridTitle: 'What are you looking for?',
  tabs: [
    { id: 'quick', label: 'Quick', icon: 'flash', color: '#6B21A8', categoryIds: [] },
    { id: 'monthly', label: 'Monthly Pass', icon: 'calendar', color: '#6B21A8', categoryIds: [] },
    { id: 'salon', label: 'Salon', icon: 'sparkles', color: '#6B21A8', categoryIds: [] },
  ],
  banners: [
    {
      id: 'b1',
      kicker: 'LIMITED OFFER',
      headline: '30% OFF',
      title: "Today's Special!",
      sub: 'Get discount for every order, only valid for today.',
      color: '#6B21A8',
      opens: 'express',
    },
    {
      id: 'b-cook',
      kicker: 'FREE TRIAL',
      headline: '3 days',
      title: 'Healthy Cook, on us',
      sub: 'Healthy home-style meals. Try 3 days free, then pick a plan.',
      color: '#059669',
      opens: 'cook',
    },
  ],
  trust: [
    { icon: 'shield-checkmark', label: 'Verified pros' },
    { icon: 'leaf', label: 'Healthy meals' },
    { icon: 'flash', label: '15-min arrival' },
    { icon: 'navigate', label: 'Live tracking' },
    { icon: 'lock-closed', label: 'OTP check-in' },
  ],
  howTitle: 'How Szoop works',
  howSteps: [
    { n: '1', title: 'Pick a service', body: 'Cleaning, cook, diet meals…' },
    { n: '2', title: 'Choose time & duration', body: 'Right now or any slot you like' },
    { n: '3', title: 'Relax & track', body: 'Expert arrives with OTP' },
  ],
  bottomTitle: 'Need help right now?',
  bottomSub: 'An expert at your door in about 15 minutes.',
  bottomButton: 'Book',
};

function text(value: unknown, fallback: string, max: number) {
  const next = typeof value === 'string' ? value.trim() : '';
  return (next || fallback).slice(0, max);
}

/** Default category matching per well-known tab id, used when a tab has no pinned categoryIds. */
const TAB_MATCHERS: Record<string, RegExp> = {
  quick: /express|quick|hourly|on[\s-]?demand|instant|by the hour/i,
  monthly: /monthly|pass|subscription|every day/i,
  salon: /salon|beauty|luxe|aira|spa|groom/i,
};

type TabCategory = { id: string; title: string; subtitle: string | null };

/**
 * Gives every tab the ids of the (active) categories it shows. Each category lands in one tab;
 * categories no tab claims go to the first tab so nothing disappears. Empty tabs are dropped.
 */
export function resolveHomeTabs(tabs: HomeScreenTab[], categories: TabCategory[]): HomeScreenTab[] {
  const activeIds = new Set(categories.map((c) => c.id));
  const claimed = new Set<string>();
  const resolved = tabs.map((tab) => {
    const pinned = tab.categoryIds.filter((id) => activeIds.has(id) && !claimed.has(id));
    pinned.forEach((id) => claimed.add(id));
    return { ...tab, categoryIds: pinned };
  });
  for (const tab of resolved) {
    const matcher = TAB_MATCHERS[tab.id];
    if (tab.categoryIds.length || !matcher) continue;
    for (const category of categories) {
      if (claimed.has(category.id)) continue;
      if (matcher.test(`${category.title} ${category.subtitle ?? ''}`)) {
        tab.categoryIds.push(category.id);
        claimed.add(category.id);
      }
    }
  }
  const leftovers = categories.filter((c) => !claimed.has(c.id)).map((c) => c.id);
  if (leftovers.length && resolved.length) resolved[0].categoryIds.push(...leftovers);
  return resolved.filter((tab) => tab.categoryIds.length);
}

export function normalizeHomeScreen(value: unknown): HomeScreenConfig {
  const raw = value && typeof value === 'object' ? (value as Partial<HomeScreenConfig>) : {};
  const base = DEFAULT_HOME_SCREEN;
  const tabs = Array.isArray(raw.tabs)
    ? raw.tabs.slice(0, 6).map((item, index) => {
        const tab = item && typeof item === 'object' ? (item as Partial<HomeScreenTab>) : {};
        return {
          id: text(tab.id, `tab-${index + 1}`, 40),
          label: text(tab.label, `Tab ${index + 1}`, 24),
          icon: text(tab.icon, 'grid', 40),
          color: text(tab.color, '#6B21A8', 20),
          categoryIds: Array.isArray(tab.categoryIds)
            ? tab.categoryIds.filter((id): id is string => typeof id === 'string').slice(0, 20)
            : [],
        } satisfies HomeScreenTab;
      })
    : base.tabs;
  const banners = Array.isArray(raw.banners)
    ? raw.banners
        .slice(0, 6)
        .map((item, index) => {
          const banner = item && typeof item === 'object' ? (item as Partial<HomeScreenBanner>) : {};
          return {
            id: text(banner.id, `banner-${index + 1}`, 40),
            kicker: text(banner.kicker, 'OFFER', 40),
            headline: text(banner.headline, 'Today', 40),
            title: text(banner.title, 'Special', 80),
            sub: text(banner.sub, '', 160),
            color: text(banner.color, '#6B21A8', 20),
            opens: banner.opens === 'cook' ? 'cook' : 'express',
          } satisfies HomeScreenBanner;
        })
    : base.banners;
  const trust = Array.isArray(raw.trust)
    ? raw.trust.slice(0, 8).map((item) => {
        const chip = item && typeof item === 'object' ? (item as Partial<HomeScreenTrust>) : {};
        return {
          icon: text(chip.icon, 'shield-checkmark', 40),
          label: text(chip.label, 'Trusted', 40),
        };
      })
    : base.trust;
  const howSteps = Array.isArray(raw.howSteps)
    ? raw.howSteps.slice(0, 4).map((item, index) => {
        const step = item && typeof item === 'object' ? (item as Partial<HomeScreenStep>) : {};
        return {
          n: text(step.n, String(index + 1), 4),
          title: text(step.title, 'Step', 40),
          body: text(step.body, '', 80),
        };
      })
    : base.howSteps;

  return {
    searchPlaceholder: text(raw.searchPlaceholder, base.searchPlaceholder, 80),
    gridTitle: text(raw.gridTitle, base.gridTitle, 80),
    tabs: tabs.length ? tabs : base.tabs,
    banners: banners.length ? banners : base.banners,
    trust: trust.length ? trust : base.trust,
    howTitle: text(raw.howTitle, base.howTitle, 80),
    howSteps: howSteps.length ? howSteps : base.howSteps,
    bottomTitle: text(raw.bottomTitle, base.bottomTitle, 80),
    bottomSub: text(raw.bottomSub, base.bottomSub, 120),
    bottomButton: text(raw.bottomButton, base.bottomButton, 24),
  };
}
