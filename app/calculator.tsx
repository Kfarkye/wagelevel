'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import wageDataRaw from '../data/wage_data.json';
import { FAQ_ITEMS, LONG_TAIL_SECTIONS } from './seo';

type WageData = {
  metadata: { source: string; geo_delineation: string };
  soc_codes: { code: string; label: string }[];
  areas: { code: string; label: string }[];
  wage_matrix: Record<string, Record<string, [number, number, number, number]>>;
};

const wageData = wageDataRaw as unknown as WageData;

const toNumber = (value: string | number | null | undefined) => {
  if (value === '' || value === null || value === undefined) return NaN;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : NaN;
};

const copyToClipboard = async (text: string) => {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea-based fallback for restrictive WebViews.
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.top = '-1000px';
    el.style.left = '-1000px';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
};

const REG_OPEN = 'March 4, 2026 (12:00 PM ET)';
const REG_CLOSE = 'March 19, 2026 (12:00 PM ET)';

const DHS_BASELINE: Record<number, number> = {
  1: 15.29,
  2: 30.58,
  3: 45.87,
  4: 61.16,
};

const WEIGHT_ENTRIES: Record<number, number> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
};

type MemoStatus = 'idle' | 'copied' | 'failed';
const TERMS_ACCEPTED_KEY = 'wagelevel_terms_accepted_v1';

export default function WageLevelCalculator() {
  const [acceptedTerms, setAcceptedTerms] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(TERMS_ACCEPTED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [socCode, setSocCode] = useState('15-1252.00');
  const [areaCode, setAreaCode] = useState('41940');
  const [socFilter, setSocFilter] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [wage, setWage] = useState<number | ''>(135000);
  const [hasMultipleSponsors, setHasMultipleSponsors] = useState(false);
  const [isOutsideUS, setIsOutsideUS] = useState(false);
  const [memoStatus, setMemoStatus] = useState<MemoStatus>('idle');
  const [thresholdsChanged, setThresholdsChanged] = useState(false);
  const prevSocRef = useRef(socCode);
  const prevAreaRef = useRef(areaCode);

  const copyTimerRef = useRef<number | null>(null);
  const brandPillClass =
    'rounded-full border border-zinc-200/90 bg-white/90 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-200 hover:-translate-y-px hover:border-zinc-300 hover:text-zinc-900 hover:shadow-sm';
  const navPillClass =
    'rounded-full border border-zinc-200/90 bg-white/90 px-3 py-1.5 text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-200 hover:-translate-y-px hover:border-zinc-300 hover:text-zinc-900 hover:shadow-sm';
  const filterInputClass =
    'f-mono mb-2.5 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-xs text-zinc-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition-all placeholder:text-zinc-500 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/25';
  const selectInputClass =
    'f-mono w-full cursor-pointer rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition-all focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/25';
  const wageInputClass =
    'f-mono w-full rounded-xl border border-zinc-200 bg-white py-3.5 pl-9 pr-4 text-2xl font-bold tracking-tight text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition-all placeholder:text-zinc-500 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/25';

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!acceptedTerms) return;
    try {
      window.localStorage.setItem(TERMS_ACCEPTED_KEY, '1');
    } catch {
      // Ignore storage failures in private mode/restricted contexts.
    }
  }, [acceptedTerms]);

  // Flash "thresholds updated" when SOC or area changes
  useEffect(() => {
    if (socCode !== prevSocRef.current || areaCode !== prevAreaRef.current) {
      prevSocRef.current = socCode;
      prevAreaRef.current = areaCode;
      setThresholdsChanged(true);
      const timer = window.setTimeout(() => setThresholdsChanged(false), 2500);
      return () => window.clearTimeout(timer);
    }
  }, [socCode, areaCode]);

  const numericWageRaw = toNumber(wage);
  const wageIsValid = Number.isFinite(numericWageRaw);
  const numericWage = wageIsValid ? Math.max(0, Math.trunc(numericWageRaw)) : 0;

  const sortedSocCodes = useMemo(
    () =>
      [...wageData.soc_codes].sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
      ),
    []
  );
  const sortedAreas = useMemo(
    () =>
      [...wageData.areas].sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
      ),
    []
  );

  const socFilterNormalized = socFilter.trim().toLowerCase();
  const areaFilterNormalized = areaFilter.trim().toLowerCase();

  const socMatches = useMemo(() => {
    if (!socFilterNormalized) return sortedSocCodes;
    return sortedSocCodes.filter((soc) =>
      `${soc.code} ${soc.label}`.toLowerCase().includes(socFilterNormalized)
    );
  }, [socFilterNormalized, sortedSocCodes]);

  const areaMatches = useMemo(() => {
    if (!areaFilterNormalized) return sortedAreas;
    return sortedAreas.filter((area) =>
      `${area.code} ${area.label}`.toLowerCase().includes(areaFilterNormalized)
    );
  }, [areaFilterNormalized, sortedAreas]);

  const socOptions = useMemo(() => {
    if (socMatches.some((soc) => soc.code === socCode)) return socMatches;
    const selected = sortedSocCodes.find((soc) => soc.code === socCode);
    return selected ? [selected, ...socMatches] : socMatches;
  }, [socMatches, socCode, sortedSocCodes]);

  const areaOptions = useMemo(() => {
    if (areaMatches.some((area) => area.code === areaCode)) return areaMatches;
    const selected = sortedAreas.find((area) => area.code === areaCode);
    return selected ? [selected, ...areaMatches] : areaMatches;
  }, [areaMatches, areaCode, sortedAreas]);

  const rawThresholds = useMemo(
    () => wageData.wage_matrix?.[socCode]?.[areaCode],
    [socCode, areaCode]
  );

  const thresholds = useMemo<[number, number, number, number] | null>(() => {
    if (!Array.isArray(rawThresholds) || rawThresholds.length !== 4) return null;
    const arr = rawThresholds.map((v) => Number(v)) as [number, number, number, number];
    if (!arr.every((v) => Number.isFinite(v))) return null;
    if (arr.some((v) => v <= 0)) return null;
    if (!(arr[0] <= arr[1] && arr[1] <= arr[2] && arr[2] <= arr[3])) return null;
    return arr;
  }, [rawThresholds]);

  const dataUnavailable = thresholds === null;

  const areaName = useMemo(
    () => wageData.areas.find((a) => a.code === areaCode)?.label ?? areaCode,
    [areaCode]
  );
  const socName = useMemo(
    () => wageData.soc_codes.find((s) => s.code === socCode)?.label ?? socCode,
    [socCode]
  );

  const analysis = useMemo(() => {
    if (!wageIsValid) {
      return {
        status: 'no_wage' as const,
        baseTier: null as number | null,
        gapToNext: null as number | null,
        nextThreshold: null as number | null,
        isBelowLevelOne: false,
      };
    }

    if (dataUnavailable || !thresholds) {
      return {
        status: 'no_data' as const,
        baseTier: null as number | null,
        gapToNext: null as number | null,
        nextThreshold: null as number | null,
        isBelowLevelOne: false,
      };
    }

    const levels = thresholds;
    let baseTier = 1;
    let gapToNext: number | null = null;
    let nextThreshold: number | null = null;
    let isBelowLevelOne = false;

    const gap = (from: number, to: number) => {
      const diff = to - from;
      return diff > 0 ? diff : null;
    };

    if (numericWage >= levels[3]) {
      baseTier = 4;
    } else if (numericWage >= levels[2]) {
      baseTier = 3;
      gapToNext = gap(numericWage, levels[3]);
      nextThreshold = levels[3];
    } else if (numericWage >= levels[1]) {
      baseTier = 2;
      gapToNext = gap(numericWage, levels[2]);
      nextThreshold = levels[2];
    } else if (numericWage >= levels[0]) {
      baseTier = 1;
      gapToNext = gap(numericWage, levels[1]);
      nextThreshold = levels[1];
    } else {
      baseTier = 1;
      gapToNext = gap(numericWage, levels[0]);
      nextThreshold = levels[0];
      isBelowLevelOne = true;
    }

    return {
      status: 'ok' as const,
      baseTier,
      gapToNext,
      nextThreshold,
      isBelowLevelOne,
    };
  }, [numericWage, wageIsValid, dataUnavailable, thresholds]);

  const targetTierLabel = useMemo(() => {
    if (analysis.status !== 'ok') return null;
    if (analysis.isBelowLevelOne) return 1;
    return Math.min(analysis.baseTier + 1, 4);
  }, [analysis]);

  const odds = useMemo(() => {
    if (analysis.status !== 'ok') return null;
    return {
      pct: DHS_BASELINE[analysis.baseTier],
      entries: WEIGHT_ENTRIES[analysis.baseTier],
    };
  }, [analysis]);

  const memoStatusMessage =
    memoStatus === 'copied'
      ? 'Memo copied to clipboard.'
      : memoStatus === 'failed'
        ? 'Memo copy failed. Please try again.'
        : '';

  const generateMemo = async () => {
    if (analysis.status !== 'ok' || !odds) return;

    const { baseTier, gapToNext, nextThreshold, isBelowLevelOne } = analysis;

    let thresholdNote = '';
    if (gapToNext !== null && nextThreshold !== null) {
      if (isBelowLevelOne) {
        thresholdNote = `\n\nThreshold Note: My guaranteed wage is currently $${gapToNext.toLocaleString()} below the OEWS Level 1 threshold ($${nextThreshold.toLocaleString()}) for this SOC/Area. Weighting cannot go below Level 1 (1 entry), but this indicates the offer is below the Level 1 benchmark and should be reviewed for compliance risk prior to close of registration (${REG_CLOSE}).`;
      } else {
        const tLabel = targetTierLabel ?? Math.min(baseTier + 1, 4);
        const entries = WEIGHT_ENTRIES[tLabel] ?? tLabel;
        thresholdNote = `\n\nThreshold Note: The OEWS Level ${tLabel} threshold for this SOC/Area is $${nextThreshold.toLocaleString()}. I would like to discuss whether my guaranteed compensation can be adjusted by $${gapToNext.toLocaleString()} prior to close of registration (${REG_CLOSE}) to reach Level ${tLabel} weighting (${entries} ${entries === 1 ? 'entry' : 'entries'}).`;
      }
    }

    const multiRegNote = hasMultipleSponsors
      ? `\n\nCRITICAL — MULTIPLE REGISTRATIONS: Under the final DHS rule, if a beneficiary has registrations at different wage levels, USCIS assigns the lowest equivalent wage level among them for selection weighting. I need to confirm all registrations match my highest tier to avoid mathematically downgrading my primary offer.`
      : '';

    const outsideNote = isOutsideUS
      ? `\n\nSTATUS NOTE: I am currently outside the U.S. or not in valid nonimmigrant status. The Sept 19, 2025 Presidential Proclamation establishes a $100,000 payment requirement for certain new H-1B petitions involving beneficiaries outside the U.S. Counsel should confirm applicability before filing.`
      : '';

    const sourceLine = wageData.metadata?.source ?? 'OFLC wage data';

    const memo = `MEMORANDUM FOR IMMIGRATION COUNSEL / HR
RE: FY2027 H-1B Cap Registration — Wage Level Assessment

Based on the ${sourceLine} for ${socName} in the ${areaName} area, a guaranteed registration wage of $${numericWage.toLocaleString()} maps to OEWS Wage Level ${baseTier}.

DHS baseline selection probability for Level ${baseTier}: ${odds.pct.toFixed(2)}% (${odds.entries} ${odds.entries === 1 ? 'entry' : 'entries'}). These are modeled baselines; actual outcomes vary with total registration volume and wage-level distribution.${thresholdNote}${multiRegNote}${outsideNote}

Registration window: ${REG_OPEN} → ${REG_CLOSE}.

(Generated via wagelevel.fyi. Mathematical estimation using public OFLC/DHS data. Not legal advice. Counsel makes final SOC, wage, and filing strategy determinations.)`;

    const ok = await copyToClipboard(memo);
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    setMemoStatus(ok ? 'copied' : 'failed');
    copyTimerRef.current = window.setTimeout(() => setMemoStatus('idle'), 3000);
  };

  return (
    <div className="relative min-h-[100svh] text-zinc-800 antialiased">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-teal-500/60 to-transparent"
      />
      <div className="relative mx-auto max-w-[1280px] px-5 pb-14 pt-10 md:px-6 md:pb-20 md:pt-14">
        <header className="surface-card mb-10 rounded-3xl p-6 md:p-8">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <Link
              href="/"
              className={brandPillClass}
            >
              wagelevel.fyi
            </Link>
            <nav aria-label="Primary" className="flex flex-wrap gap-2 text-[11px]">
              <a
                href="#calculator"
                className={navPillClass}
              >
                Calculator
              </a>
              <Link
                href="/wages"
                className={navPillClass}
              >
                Browse Wages
              </Link>
              <Link
                href="/prevailing-wage-h1b-calculator"
                className={navPillClass}
              >
                Prevailing Wage H-1B
              </Link>
              <Link
                href="/uscis-wage-level-calculator"
                className={navPillClass}
              >
                USCIS Wage Level
              </Link>
              <a
                href="#faq"
                className={navPillClass}
              >
                FAQ
              </a>
            </nav>
          </div>
          <div className="max-w-3xl space-y-4">
            <h1 className="hero-title text-3xl font-semibold leading-tight text-zinc-900 md:text-4xl">
              H-1B Wage Level Calculator
            </h1>
            <p className="max-w-2xl text-[15px] leading-relaxed text-zinc-700">
              Use this H-1B and OEWS wage level calculator to map a guaranteed wage by SOC code
              and worksite area, then compare prevailing-wage context and DHS baseline selection
              probabilities.
            </p>
            <div className="f-mono inline-flex items-center gap-2 rounded-lg border border-zinc-200/90 bg-white/90 px-3 py-2 text-[11px] text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-teal-600/70" />
              {REG_OPEN}
              {' -> '}
              {REG_CLOSE}
            </div>
            <div className="pt-2">
              <p className="mb-3 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                Popular search paths
              </p>
              <div className="flex flex-wrap gap-2">
                {LONG_TAIL_SECTIONS.map((section) => (
                  <Link
                    key={section.id}
                    href={section.href}
                    className="rounded-full border border-zinc-200/90 bg-white/90 px-3 py-2 text-[12px] text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-200 hover:-translate-y-px hover:border-zinc-300 hover:text-zinc-900 hover:shadow-sm"
                  >
                    {section.eyebrow}
                  </Link>
                ))}
                <Link
                  href="/wages"
                  className="rounded-full border border-teal-200 bg-teal-50 px-3 py-2 text-[12px] text-teal-800 transition-colors hover:bg-teal-100"
                >
                  Browse H-1B wages by occupation
                </Link>
              </div>
            </div>
          </div>
        </header>

        <section className="mb-14 space-y-12 md:space-y-14" aria-labelledby="editorial-context-heading">
          <h2 id="editorial-context-heading" className="sr-only">
            Editorial context for the FY 2027 H-1B weighted selection rule
          </h2>

          <article className="space-y-4">
            <h2 className="hero-title text-2xl font-semibold leading-tight text-zinc-900 md:text-3xl">
              What changed
            </h2>
            <h3 className="text-lg font-semibold tracking-tight text-zinc-800 md:text-xl">
              The selection process changed on February 27, 2026
            </h3>
            <p className="max-w-4xl text-[15px] leading-7 text-zinc-700">
              DHS replaced the random H-1B cap lottery with a weighted selection process for FY
              2027. Instead of one equal entry per registration, each case now receives entries
              based on the wage level of the offered salary.
            </p>
            <p className="max-w-4xl text-[15px] leading-7 text-zinc-700">
              The weighting uses a 4:3:2:1 ratio across Levels IV through I. Level IV receives four
              entries and Level I receives one. Each unique beneficiary still counts once toward the
              annual 85,000 cap. The weighting changes selection probability, not the cap size.
              <a
                className="ml-1 underline underline-offset-2 transition-colors hover:text-zinc-900"
                href="https://www.federalregister.gov/documents/2025/12/29/2025-23853/weighted-selection-process-for-registrants-and-petitioners-seeking-to-file-cap-subject-h-1b"
                target="_blank"
                rel="noreferrer"
              >
                Source: Federal Register (Dec 29, 2025)
              </a>
            </p>
            <table className="f-mono w-full max-w-xl border-collapse text-sm text-zinc-800">
              <caption className="mb-3 text-left text-[11px] uppercase tracking-[0.12em] text-zinc-500">
                Weighted entries by wage level
              </caption>
              <thead>
                <tr className="border-b border-zinc-200">
                  <th className="px-0 py-2 text-left font-semibold text-zinc-600">Wage level</th>
                  <th className="px-0 py-2 text-left font-semibold text-zinc-600">Entries</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-zinc-100">
                  <td className="px-0 py-2">Level IV</td>
                  <td className="px-0 py-2">4</td>
                </tr>
                <tr className="border-b border-zinc-100">
                  <td className="px-0 py-2">Level III</td>
                  <td className="px-0 py-2">3</td>
                </tr>
                <tr className="border-b border-zinc-100">
                  <td className="px-0 py-2">Level II</td>
                  <td className="px-0 py-2">2</td>
                </tr>
                <tr>
                  <td className="px-0 py-2">Level I</td>
                  <td className="px-0 py-2">1</td>
                </tr>
              </tbody>
            </table>
          </article>

          <article className="space-y-4">
            <h2 className="hero-title text-2xl font-semibold leading-tight text-zinc-900 md:text-3xl">
              Why this matters if you&apos;re being sponsored
            </h2>
            <p className="max-w-4xl text-[15px] leading-7 text-zinc-700">
              Before this rule, wage level did not affect lottery odds. Now it does. A Level I
              filing gets one weighted entry, while a Level IV filing gets four. Same person, same
              role, different registration weighting under the new rule.
            </p>
            <p className="max-w-4xl text-[15px] leading-7 text-zinc-700">
              For context, Economic Policy Institute analysis of fiscal year 2019 DOL certification
              data reported that 60% of H-1B positions were assigned wage levels below the local
              median (14% at Level I and 46% at Level II). DHS cited this study in the final-rule
              preamble, and said the rule is intended to favor &quot;higher-skilled and higher-paid
              aliens&quot; while keeping all wage levels in the pool.
              <a
                className="ml-1 underline underline-offset-2 transition-colors hover:text-zinc-900"
                href="https://www.epi.org/publication/h-1b-visas-and-prevailing-wage-levels/"
                target="_blank"
                rel="noreferrer"
              >
                Source: EPI (Costa &amp; Hira, May 2020)
              </a>
            </p>
          </article>

          <article className="space-y-5">
            <h2 className="hero-title text-2xl font-semibold leading-tight text-zinc-900 md:text-3xl">
              When this is a calculator question and when it isn&apos;t
            </h2>
            <div className="space-y-4">
              <div className="border-l-2 border-emerald-500/70 pl-4">
                <h3 className="text-base font-semibold text-zinc-900">
                  You probably just need the lookup
                </h3>
                <p className="mt-1 text-[14px] leading-7 text-zinc-700">
                  The SOC code matches your actual role. The offered salary meets or exceeds the
                  threshold for the assigned wage level. You mainly want to confirm the numbers.
                  Use the calculator below.
                </p>
              </div>
              <div className="border-l-2 border-amber-500/80 pl-4">
                <h3 className="text-base font-semibold text-zinc-900">Worth raising with HR</h3>
                <p className="mt-1 text-[14px] leading-7 text-zinc-700">
                  You do not know which SOC code your employer is using. You do not know the wage
                  level on your registration. The offered salary feels low relative to peers in your
                  role and location. The worksite location appears different from what is listed.
                </p>
              </div>
              <div className="border-l-2 border-red-500/80 pl-4">
                <h3 className="text-base font-semibold text-zinc-900">
                  Worth discussing with an immigration attorney
                </h3>
                <p className="mt-1 text-[14px] leading-7 text-zinc-700">
                  The assigned wage level does not match the experience required for the role. The
                  SOC code does not reflect the actual work. You believe registration details may not
                  match the petition details. USCIS states in the final rule that registration and
                  petition details must remain consistent.
                  <a
                    className="ml-1 underline underline-offset-2 transition-colors hover:text-zinc-900"
                    href="https://www.federalregister.gov/documents/2025/12/29/2025-23853/weighted-selection-process-for-registrants-and-petitioners-seeking-to-file-cap-subject-h-1b"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Source: DHS final rule
                  </a>
                </p>
              </div>
            </div>
            <p className="text-[13px] leading-6 text-zinc-500">
              This page is not legal advice. It&apos;s context for understanding your situation.
            </p>
          </article>

          <article className="space-y-4">
            <h2 className="hero-title text-2xl font-semibold leading-tight text-zinc-900 md:text-3xl">
              What to ask HR before registration closes
            </h2>
            <ol className="list-decimal space-y-2 pl-5 text-[15px] leading-7 text-zinc-700 marker:f-mono marker:text-zinc-500">
              <li>What SOC code are you using for my position?</li>
              <li>What OEWS wage level are you assigning to my registration?</li>
              <li>What geographic area of employment are you using?</li>
              <li>
                Does my offered salary meet or exceed the threshold for the selected wage level?
              </li>
              <li>Has outside immigration counsel reviewed the classification?</li>
            </ol>
            <p className="text-[13px] leading-6 text-zinc-500">
              These are reasonable questions. The new rule requires employers to certify that
              registration information is true and correct.
              <a
                className="ml-1 underline underline-offset-2 transition-colors hover:text-zinc-700"
                href="https://www.federalregister.gov/documents/2025/12/29/2025-23853/weighted-selection-process-for-registrants-and-petitioners-seeking-to-file-cap-subject-h-1b"
                target="_blank"
                rel="noreferrer"
              >
                Source: Federal Register final rule
              </a>
            </p>
          </article>
        </section>

        <div className="mb-10 grid gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <section
            id="calculator"
            className="surface-card self-start rounded-3xl p-6 md:p-8"
          >
            <div className="space-y-7">
          <div>
            <label
              htmlFor="socCode"
              className="block text-[11px] font-medium text-zinc-500 uppercase tracking-[0.12em] mb-2.5 cursor-pointer"
            >
              SOC Code
            </label>
            <input
              id="socCodeFilter"
              type="search"
              value={socFilter}
              onChange={(e) => setSocFilter(e.target.value)}
              placeholder="Search SOC title or code"
              autoComplete="off"
              aria-label="Filter SOC codes"
              aria-controls="socCode"
              className={filterInputClass}
            />
            <select
              id="socCode"
              aria-describedby="socCountText socMetaText"
              className={selectInputClass}
              value={socCode}
              onChange={(e) => setSocCode(e.target.value)}
            >
              {socOptions.map((soc) => (
                <option key={soc.code} value={soc.code}>
                  {soc.label}
                </option>
              ))}
            </select>
            <p id="socCountText" className="f-mono mt-2 text-[10px] text-zinc-500">
              Showing {socMatches.length} of {sortedSocCodes.length} SOC options
            </p>
            <p id="socMetaText" className="mt-2 text-[11px] leading-relaxed text-zinc-500">
              Counsel makes the final SOC determination. Wrong SOC = wrong thresholds.
            </p>
          </div>

          <div>
            <label
              htmlFor="areaCode"
              className="block text-[11px] font-medium text-zinc-500 uppercase tracking-[0.12em] mb-2.5 cursor-pointer"
            >
              Area of Employment
            </label>
            <input
              id="areaCodeFilter"
              type="search"
              value={areaFilter}
              onChange={(e) => setAreaFilter(e.target.value)}
              placeholder="Search area name or code"
              autoComplete="off"
              aria-label="Filter areas of employment"
              aria-controls="areaCode"
              className={filterInputClass}
            />
            <select
              id="areaCode"
              aria-describedby="areaCountText areaMetaText"
              className={selectInputClass}
              value={areaCode}
              onChange={(e) => setAreaCode(e.target.value)}
            >
              {areaOptions.map((area) => (
                <option key={area.code} value={area.code}>
                  {area.label}
                </option>
              ))}
            </select>
            <p id="areaCountText" className="f-mono mt-2 text-[10px] text-zinc-500">
              Showing {areaMatches.length} of {sortedAreas.length} area options
            </p>
            <p id="areaMetaText" className="mt-2 text-[11px] leading-relaxed text-zinc-500">
              Physical work location (remote = home worksite), not company HQ.
            </p>
          </div>

          <div>
            <label
              htmlFor="wageInput"
              className="block text-[11px] font-medium text-zinc-500 uppercase tracking-[0.12em] mb-2.5 cursor-pointer"
            >
              Guaranteed Registration Wage
            </label>
            <div className="relative">
              <span
                className="f-mono pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 select-none text-lg text-zinc-500"
                aria-hidden="true"
              >
                $
              </span>
              <input
                id="wageInput"
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="135000"
                className={wageInputClass}
                value={wage}
                onChange={(e) => {
                  const v = e.target.value;
                  setWage(v === '' ? '' : Number(v));
                }}
              />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
              Base salary + guaranteed bonuses. RSUs and discretionary bonuses do not count.
            </p>
            {thresholds && (
              <div className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] transition-all duration-500 ${
                thresholdsChanged
                  ? 'border-teal-300 bg-teal-50 text-teal-800'
                  : 'border-zinc-200 bg-zinc-50 text-zinc-600'
              }`}>
                <span className="f-mono">
                  Level I: ${thresholds[0].toLocaleString()} · Level II: ${thresholds[1].toLocaleString()} · Level III: ${thresholds[2].toLocaleString()} · Level IV: ${thresholds[3].toLocaleString()}
                </span>
                {thresholdsChanged && (
                  <span className="ml-auto whitespace-nowrap rounded-full bg-teal-600 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                    Updated
                  </span>
                )}
              </div>
            )}
          </div>

              <div className="space-y-3.5 border-t border-zinc-200 pt-5">
            <label htmlFor="multiSponsorToggle" className="flex items-start gap-3 cursor-pointer group">
              <input
                id="multiSponsorToggle"
                type="checkbox"
                className="mt-0.5 h-4 w-4 cursor-pointer rounded border-zinc-300 bg-white accent-teal-600"
                checked={hasMultipleSponsors}
                onChange={(e) => setHasMultipleSponsors(e.target.checked)}
              />
              <span className="text-[13px] leading-snug text-zinc-500 transition-colors group-hover:text-zinc-800 select-none">
                Multiple employers are submitting registrations for me
              </span>
            </label>
            <label htmlFor="outsideUsToggle" className="flex items-start gap-3 cursor-pointer group">
              <input
                id="outsideUsToggle"
                type="checkbox"
                className="mt-0.5 h-4 w-4 cursor-pointer rounded border-zinc-300 bg-white accent-teal-600"
                checked={isOutsideUS}
                onChange={(e) => setIsOutsideUS(e.target.checked)}
              />
              <span className="text-[13px] leading-snug text-zinc-500 transition-colors group-hover:text-zinc-800 select-none">
                I am outside the U.S. or not in valid nonimmigrant status
              </span>
            </label>
              </div>
            </div>
          </section>

          <section
            className="surface-card relative self-start overflow-hidden rounded-3xl lg:sticky lg:top-8"
            aria-live="polite"
          >
          <div className="p-6 md:p-8">
            <div className="mb-10 max-w-lg border-l-2 border-zinc-300 pl-4 text-[12px] leading-[1.65] text-zinc-600">
              The wage level on your registration is derived from proffered wage vs. OEWS
              thresholds - it can differ from the LCA wage level label.
            </div>

            <div className="min-h-[420px] md:min-h-[520px]">
              {!acceptedTerms ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-teal-200 bg-teal-50 p-5 md:p-6">
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-zinc-200 bg-white">
                      <span className="text-lg">⚖️</span>
                    </div>
                    <h3
                      id="termsTitle"
                      className="mb-3 text-[15px] font-semibold tracking-tight text-zinc-900"
                    >
                      Before you continue
                    </h3>
                    <div
                      id="termsBody"
                      className="space-y-3 text-left text-[12px] leading-[1.6] text-zinc-600"
                    >
                      <p>
                        This tool maps wages to OEWS thresholds using public data. The creators are
                        not attorneys. This is not legal advice.
                      </p>
                      <p>
                        USCIS can deny or revoke petitions if it determines inputs were selected to
                        unfairly increase selection weighting.
                      </p>
                    </div>
                    <button
                      onClick={() => setAcceptedTerms(true)}
                      className="mt-5 w-full rounded-xl border border-teal-200 bg-white px-4 py-3 text-[13px] font-semibold tracking-wide text-teal-900 transition-all hover:bg-teal-100 focus:outline-none focus:ring-2 focus:ring-teal-500/35 active:scale-[0.98]"
                    >
                      I understand - show results
                    </button>
                  </div>

                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-5">
                    <p className="mb-1.5 text-sm font-medium text-zinc-800">Results are locked until you acknowledge the note above</p>
                    <p className="text-[12px] leading-relaxed text-zinc-500">
                      Your inputs are still visible and scrollable on mobile. Once you unlock the
                      pane, the calculator will show tier, probability, and threshold analysis here.
                    </p>
                  </div>
                </div>
              ) : analysis.status === 'no_wage' ? (
                <div className="afu rounded-xl border border-sky-500/20 bg-sky-500/[0.06] p-5">
                  <p className="text-sm text-zinc-700 font-medium mb-1.5">Enter a wage to calculate</p>
                  <p className="text-[12px] text-zinc-500 leading-relaxed">
                    Tier and probability are suppressed until a valid guaranteed wage is entered.
                  </p>
                </div>
              ) : analysis.status === 'no_data' ? (
                <div className="afu bg-red-500/5 border border-red-500/10 rounded-xl p-5">
                  <p className="text-sm text-red-400 font-medium mb-1.5">No threshold data</p>
                  <p className="text-[12px] text-zinc-500 leading-relaxed">
                    SOC <span className="f-mono text-zinc-700">{socCode}</span> in area{' '}
                    <span className="f-mono text-zinc-700">{areaCode}</span> has no usable wage
                    thresholds in this dataset.
                  </p>
                </div>
              ) : (
                <>
                  <div className="afu mb-10">
                    <div className="mb-8">
                      <p className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] font-medium mb-3">
                        Calculated Tier
                      </p>
                      <div className="flex items-baseline gap-3">
                        <span className="text-6xl md:text-7xl font-bold leading-none tracking-tight text-zinc-900">
                          {analysis.baseTier}
                        </span>
                        <span className="text-lg md:text-xl italic text-zinc-500">of 4</span>
                      </div>
                      <p className="f-mono mt-3 text-[10px] text-zinc-500">
                        {socCode} · {areaCode}
                      </p>
                    </div>

                    <div className="afu d1 flex flex-col sm:flex-row gap-6 sm:gap-10">
                      <div>
                        <p className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] font-medium mb-2">
                          DHS Baseline Probability
                        </p>
                        <span className="f-mono text-3xl font-bold tracking-tight text-teal-700">
                          {odds ? `${odds.pct.toFixed(2)}%` : '-'}
                        </span>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] font-medium mb-2">
                          Lottery Entries
                        </p>
                        <div className="flex items-baseline gap-1.5">
                          <span className="f-mono text-3xl font-bold tracking-tight text-zinc-900">
                            {odds?.entries ?? '-'}
                          </span>
                          <span className="text-sm text-zinc-500">x weight</span>
                        </div>
                      </div>
                    </div>

                    <p className="mt-4 max-w-sm text-[10px] leading-relaxed text-zinc-500">
                      Modeled baselines from the final rule. Actual outcomes vary with total
                      registrations and wage-level mix.
                    </p>
                  </div>

                  <div className="space-y-3">
                    {analysis.gapToNext !== null && analysis.nextThreshold !== null && (
                      <div
                        className={`afu d2 rounded-xl p-5 ${
                          analysis.isBelowLevelOne
                            ? 'bg-red-500/[0.04] border border-red-500/10'
                            : 'bg-amber-500/[0.04] border border-amber-500/10'
                        }`}
                      >
                        <p
                          className={`text-[11px] font-medium uppercase tracking-wider mb-2 ${
                            analysis.isBelowLevelOne
                              ? 'text-red-400/80'
                              : 'text-amber-400/80'
                          }`}
                        >
                          {analysis.isBelowLevelOne ? 'Below Level 1 Threshold' : 'Threshold Analysis'}
                        </p>
                        <p className="text-[13px] text-zinc-500 leading-[1.65]">
                          {analysis.isBelowLevelOne ? (
                            <>
                              Your wage (
                              <span className="f-mono text-zinc-700">
                                ${numericWage.toLocaleString()}
                              </span>
                              ) is{' '}
                              <span className="f-mono font-semibold text-zinc-900">
                                ${analysis.gapToNext.toLocaleString()}
                              </span>{' '}
                              below the OEWS Level 1 threshold (
                              <span className="f-mono">
                                ${analysis.nextThreshold.toLocaleString()}
                              </span>
                              ). Weighting cannot go below Level 1 (1 entry), but this is a
                              compliance red flag.
                            </>
                          ) : (
                            <>
                              Your wage (
                              <span className="f-mono text-zinc-700">
                                ${numericWage.toLocaleString()}
                              </span>
                              ) is{' '}
                              <span className="f-mono font-semibold text-zinc-900">
                                ${analysis.gapToNext.toLocaleString()}
                              </span>{' '}
                              below the Level {targetTierLabel} threshold (
                              <span className="f-mono">
                                ${analysis.nextThreshold.toLocaleString()}
                              </span>
                              ). At or above -&gt; Level {targetTierLabel} (
                              {WEIGHT_ENTRIES[targetTierLabel ?? 0] ?? '?'} entries).
                            </>
                          )}{' '}
                          USCIS scrutiny increases when compensation is adjusted solely to change
                          weighting.
                        </p>
                      </div>
                    )}

                    {hasMultipleSponsors && (
                      <div className="afu d3 rounded-xl p-5 bg-orange-500/[0.04] border border-orange-500/10">
                        <p className="text-[11px] font-medium text-orange-400/80 uppercase tracking-wider mb-2">
                          Multiple Registration Impact
                        </p>
                        <p className="text-[13px] text-zinc-500 leading-[1.65]">
                          If registrations exist at different wage levels, USCIS assigns selection
                          weighting using the lowest equivalent wage level among them. Confirm all
                          registrations match your highest tier before {REG_CLOSE}.
                        </p>
                      </div>
                    )}

                    {isOutsideUS && (
                      <div className="afu d4 rounded-xl border border-sky-500/20 bg-sky-500/[0.06] p-5">
                        <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-sky-300/90">
                          $100,000 Payment Warning
                        </p>
                        <p className="text-[13px] text-zinc-500 leading-[1.65]">
                          The Sept 19, 2025 Presidential Proclamation establishes a $100,000 payment
                          for certain new H-1B petitions involving beneficiaries outside the U.S.
                          Counsel should confirm applicability, exemptions, and current effective
                          status.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="mt-10 pt-8 border-t border-zinc-200">
                    <button
                      onClick={() => {
                        void generateMemo();
                      }}
                      disabled={analysis.status !== 'ok'}
                      aria-label="Generate plain-text memo for HR and counsel"
                      className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-[13px] font-semibold tracking-wide transition-all duration-300 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white ${
                        memoStatus === 'copied'
                          ? 'border border-teal-200 bg-teal-50 text-teal-700 focus:ring-teal-500/35'
                          : memoStatus === 'failed'
                            ? 'bg-red-500/10 text-red-400 border border-red-500/20 focus:ring-red-500/30'
                            : 'border border-teal-200 bg-teal-50 text-teal-900 hover:bg-teal-100 focus:ring-teal-500/35'
                      }`}
                    >
                      {memoStatus === 'copied'
                        ? '✓ Copied to clipboard'
                        : memoStatus === 'failed'
                          ? 'Copy failed - try again'
                          : 'Generate memo for HR & counsel'}
                    </button>
                    <p className="sr-only" aria-live="polite">
                      {memoStatusMessage}
                    </p>
                    <p className="mt-3 text-center text-[10px] leading-relaxed text-zinc-500">
                      Plain-text memo with SOC/Area, wage level, baseline probability, and
                      applicable diagnostics.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
          </section>
        </div>

        <section className="mt-12 grid gap-5 md:grid-cols-2">
          {LONG_TAIL_SECTIONS.map((section) => (
            <article
              key={section.id}
              id={section.id}
              className="surface-card rounded-3xl p-6 md:p-7"
            >
              <h2 className="hero-title mb-3 text-xl font-semibold tracking-tight text-zinc-900 md:text-2xl">
                {section.title}
              </h2>
              <p className="text-[14px] text-zinc-500 leading-7">{section.body}</p>
              <p className="text-[13px] text-zinc-500 leading-6 mt-3">{section.detail}</p>
              <Link
                href={section.href}
                className="inline-flex items-center mt-5 text-[12px] font-medium text-teal-700 hover:text-teal-800 transition-colors underline underline-offset-4"
              >
                Open the dedicated landing page
              </Link>
            </article>
          ))}
        </section>

        <section id="faq" className="surface-card mt-12 rounded-3xl p-6 md:p-8">
          <p className="mb-3 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            FAQ
          </p>
          <h2 className="hero-title mb-6 text-xl font-semibold tracking-tight text-zinc-900 md:text-2xl">
            H-1B wage level FAQ
          </h2>
          <div className="space-y-5">
            {FAQ_ITEMS.map((item) => (
              <article key={item.question}>
                <h3 className="mb-2 text-[15px] font-semibold text-zinc-900">{item.question}</h3>
                <p className="text-[13px] text-zinc-500 leading-6">{item.answer}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="sources" className="surface-card mt-12 rounded-3xl p-6 md:p-8">
          <h2 className="hero-title mb-5 text-xl font-semibold tracking-tight text-zinc-900 md:text-2xl">
            Sources
          </h2>
          <div className="space-y-6">
            <div>
              <h3 className="mb-2 text-[14px] font-semibold text-zinc-900">Wage data</h3>
              <p className="text-[13px] leading-6 text-zinc-500">
                OFLC Occupational Employment and Wage Statistics (OEWS), July 2025–June 2026.
                Published by the Bureau of Labor Statistics and used by the National Prevailing Wage
                Center. 62,726 records.
              </p>
              <a
                className="text-[12px] text-teal-700 underline underline-offset-2 transition-colors hover:text-teal-800"
                href="https://flag.dol.gov"
                target="_blank"
                rel="noreferrer"
              >
                Source: flag.dol.gov
              </a>
            </div>
            <div>
              <h3 className="mb-2 text-[14px] font-semibold text-zinc-900">
                Weighted selection rule
              </h3>
              <p className="text-[13px] leading-6 text-zinc-500">
                DHS Final Rule published December 29, 2025, effective February 27, 2026. Applies to
                cap-subject H-1B registrations for FY 2027 and beyond.
              </p>
              <a
                className="text-[12px] text-teal-700 underline underline-offset-2 transition-colors hover:text-teal-800"
                href="https://www.federalregister.gov/documents/2025/12/29/2025-23853/weighted-selection-process-for-registrants-and-petitioners-seeking-to-file-cap-subject-h-1b"
                target="_blank"
                rel="noreferrer"
              >
                Source: Federal Register 90 FR 60870
              </a>
            </div>
          </div>
        </section>

        <footer className="mt-12 space-y-2 border-t border-zinc-200 pt-7">
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-[10px] text-zinc-500">
            <Link className="hover:text-zinc-700 transition-colors" href="/">
              Home calculator
            </Link>
            <Link
              className="hover:text-zinc-700 transition-colors"
              href="/prevailing-wage-h1b-calculator"
            >
              Prevailing wage H-1B calculator
            </Link>
            <Link
              className="hover:text-zinc-700 transition-colors"
              href="/uscis-wage-level-calculator"
            >
              USCIS wage level calculator
            </Link>
          </div>
          <p className="text-[10px] leading-relaxed text-zinc-500">
            Not affiliated with USCIS, DHS, DOL, or OFLC. Baselines are DHS model outputs; actual
            FY2027 outcomes depend on registration volume and wage-level distribution.
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-500">
            <a
              className="underline underline-offset-2 hover:text-zinc-500 transition-colors"
              href="https://www.uscis.gov/newsroom/alerts/fy-2027-h-1b-cap-initial-registration-period-opens-on-march-4"
              target="_blank"
              rel="noreferrer"
            >
              USCIS FY2027 registration window
            </a>
            <a
              className="underline underline-offset-2 hover:text-zinc-500 transition-colors"
              href="https://www.federalregister.gov/documents/2025/12/29/2025-23853/weighted-selection-process-for-registrants-and-petitioners-seeking-to-file-cap-subject-h-1b"
              target="_blank"
              rel="noreferrer"
            >
              Federal Register final rule (Dec 29, 2025)
            </a>
          </div>
          <p className="text-[10px] text-zinc-800">© 2026 wagelevel.fyi · All times Eastern.</p>
        </footer>
      </div>
    </div>
  );
}
