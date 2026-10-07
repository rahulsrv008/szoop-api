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

export type HomeScreenConfig = {
  searchPlaceholder: string;
  gridTitle: string;
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
  howTitle: 'How Oseedy works',
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

export function normalizeHomeScreen(value: unknown): HomeScreenConfig {
  const raw = value && typeof value === 'object' ? (value as Partial<HomeScreenConfig>) : {};
  const base = DEFAULT_HOME_SCREEN;
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
    banners: banners.length ? banners : base.banners,
    trust: trust.length ? trust : base.trust,
    howTitle: text(raw.howTitle, base.howTitle, 80),
    howSteps: howSteps.length ? howSteps : base.howSteps,
    bottomTitle: text(raw.bottomTitle, base.bottomTitle, 80),
    bottomSub: text(raw.bottomSub, base.bottomSub, 120),
    bottomButton: text(raw.bottomButton, base.bottomButton, 24),
  };
}
