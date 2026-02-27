'use client';

import { useMemo, useState, useRef, useEffect } from 'react';
import wageDataRaw from '../data/wage_data.json';

/* ============================================================================
   TYPE CONTRACTS & UTILS
   ============================================================================ */

type WageData = {
  metadata: { source: string; geo_delineation: string };
  soc_codes: { code: string; label: string }[];
  areas: { code: string; label: string }[];
  wage_matrix: Record<string, Record<string, [number, number, number, number]>>;
};

const wageData = wageDataRaw as unknown as WageData;

// Strict number sanitizer — rejects NaN, Infinity, empty strings
const toNumber = (value: string | number | null | undefined) => {
  if (value === '' || value === null || value === undefined) return NaN;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : NaN;
};

// WebView-safe clipboard fallback (Reddit/Blind in-app browsers block navigator.clipboard)
const copyToClipboard = async (text: string) => {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* swallow — fall through to execCommand */ }
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

/* ============================================================================
   CONSTANTS — SOURCED FROM PRIMARY MATERIALS
   Final rule: 90 Fed. Reg. 60864 (Dec 29, 2025) — effective Feb 27, 2026.
   USCIS FY2027 registration window: Mar 4 → Mar 19, 2026 (12pm ET).
   ============================================================================ */

const FY_LABEL = 'FY2027';
const REG_OPEN = 'March 4, 2026 (12:00 PM ET)';
const REG_CLOSE = 'March 19, 2026 (12:00 PM ET)';

// DHS baseline model probabilities — published discussion (modeled using FY2020–FY2024 data)
const DHS_BASELINE: Record<number, number> = {
  1: 15.29,
  2: 30.58,
  3: 45.87,
  4: 61.16,
};

// Weighted entries: Level I = 1×, II = 2×, III = 3×, IV = 4×
const WEIGHT_ENTRIES: Record<number, number> = {
  1: 1, 2: 2, 3: 3, 4: 4,
};

type MemoStatus = 'idle' | 'copied' | 'failed';

/* ============================================================================
   COMPONENT
   ============================================================================ */

export default function H1BAuditor() {
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [socCode, setSocCode] = useState('15-1252.00');
  const [areaCode, setAreaCode] = useState('41940');
  const [wage, setWage] = useState<number | ''>(135000);
  const [hasMultipleSponsors, setHasMultipleSponsors] = useState(false);
  const [isOutsideUS, setIsOutsideUS] = useState(false);
  const [memoStatus, setMemoStatus] = useState<MemoStatus>('idle');

  // Debounce timer for rapid clicks
  const copyTimerRef = useRef<number | null>(null);
  useEffect(() => {
    return () => { if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current); };
  }, []);

  /* ── Derived values ──────────────────────────────────────────────── */

  const numericWageRaw = toNumber(wage);
  const wageIsValid = Number.isFinite(numericWageRaw);
  const numericWage = wageIsValid ? Math.max(0, Math.trunc(numericWageRaw)) : 0;

  const rawThresholds = useMemo(
    () => wageData.wage_matrix?.[socCode]?.[areaCode],
    [socCode, areaCode]
  );

  // Strict data guard — prevents mis-ranking on malformed federal data rows
  // Must be: array of 4, all finite, all > 0, non-decreasing (L1 ≤ L2 ≤ L3 ≤ L4)
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

  /* ── MATH ENGINE — O(1), zero network, deterministic ─────────────── */

  const analysis = useMemo(() => {
    // Empty/invalid wage → suppress all output
    if (!wageIsValid) {
      return {
        status: 'no_wage' as const,
        baseTier: null as number | null,
        gapToNext: null as number | null,
        nextThreshold: null as number | null,
        isBelowLevelOne: false,
      };
    }

    // Missing or malformed threshold data
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

    // Returns null when diff ≤ 0 to suppress "$0 below" messaging
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
    return Math.min(analysis.baseTier! + 1, 4);
  }, [analysis]);

  const odds = useMemo(() => {
    if (analysis.status !== 'ok') return null;
    return {
      pct: DHS_BASELINE[analysis.baseTier!],
      entries: WEIGHT_ENTRIES[analysis.baseTier!],
    };
  }, [analysis]);

  /* ── VIRAL MEMO EXPORT ───────────────────────────────────────────── */

  const generateMemo = async () => {
    if (analysis.status !== 'ok' || !odds) return;

    const { baseTier, gapToNext, nextThreshold, isBelowLevelOne } = analysis;

    let thresholdNote = '';
    if (gapToNext !== null && nextThreshold !== null) {
      if (isBelowLevelOne) {
        thresholdNote = `\n\nThreshold Note: My guaranteed wage is currently $${gapToNext.toLocaleString()} below the OEWS Level 1 threshold ($${nextThreshold.toLocaleString()}) for this SOC/Area. Weighting cannot go below Level 1 (1 entry), but this indicates the offer is below the Level 1 benchmark and should be reviewed for compliance risk prior to close of registration (${REG_CLOSE}).`;
      } else {
        const tLabel = targetTierLabel ?? Math.min(baseTier! + 1, 4);
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

  /* ============================================================================
     RENDER
     ============================================================================ */

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 antialiased">
      <style dangerouslySetInnerHTML={{ __html: `
        :root {
          --font-sans: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, 'Apple Color Emoji', 'Segoe UI Emoji';
          --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
          --font-display: ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif;
          --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
        }
        .f-sans { font-family: var(--font-sans); }
        .f-mono { font-family: var(--font-mono); }
        .f-display { font-family: var(--font-display); }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .afu { animation: fadeUp 0.5s var(--ease-out-expo) both; }
        .d1 { animation-delay: 80ms; }
        .d2 { animation-delay: 160ms; }
        .d3 { animation-delay: 240ms; }
        .d4 { animation-delay: 320ms; }
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
      `}} />

      <div className="max-w-2xl mx-auto px-5 py-12 md:py-20 f-sans">

        {/* ── HEADER ──────────────────────────────────────────────── */}
        <header className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <h1 className="text-lg md:text-xl font-semibold text-white tracking-tight leading-tight">
              H-1B Wage Level Calculator
            </h1>
            <span className="text-[9px] font-bold tracking-[0.15em] uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full whitespace-nowrap">
              {FY_LABEL}
            </span>
          </div>
          <p className="text-[15px] text-zinc-500 leading-relaxed max-w-md">
            Map your guaranteed wage to OEWS Level I–IV and view DHS baseline selection
            probabilities under the weighted selection rule.
          </p>
          <div className="mt-4 flex items-center gap-2 text-[11px] text-zinc-600 f-mono">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500/60" />
            {REG_OPEN} → {REG_CLOSE}
          </div>
        </header>

        {/* ── INPUT PANEL ─────────────────────────────────────────── */}
        <section className="border border-zinc-800/60 rounded-2xl p-6 md:p-8 space-y-7 mb-8">

          {/* SOC Code */}
          <div>
            <label htmlFor="socCode" className="block text-[11px] font-medium text-zinc-500 uppercase tracking-[0.12em] mb-2.5 cursor-pointer">
              SOC Code
            </label>
            <select id="socCode"
              className="w-full bg-zinc-950 border border-zinc-800/80 text-white p-3 rounded-xl text-sm f-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-transparent transition-all cursor-pointer"
              value={socCode} onChange={(e) => setSocCode(e.target.value)}>
              {wageData.soc_codes.map((soc) => (
                <option key={soc.code} value={soc.code}>{soc.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-zinc-700 mt-2 leading-relaxed">
              Counsel makes the final SOC determination. Wrong SOC = wrong thresholds.
            </p>
          </div>

          {/* Area */}
          <div>
            <label htmlFor="areaCode" className="block text-[11px] font-medium text-zinc-500 uppercase tracking-[0.12em] mb-2.5 cursor-pointer">
              Area of Employment
            </label>
            <select id="areaCode"
              className="w-full bg-zinc-950 border border-zinc-800/80 text-white p-3 rounded-xl text-sm f-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-transparent transition-all cursor-pointer"
              value={areaCode} onChange={(e) => setAreaCode(e.target.value)}>
              {wageData.areas.map((area) => (
                <option key={area.code} value={area.code}>{area.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-zinc-700 mt-2 leading-relaxed">
              Physical work location (remote = home worksite), not company HQ.
            </p>
          </div>

          {/* Wage */}
          <div>
            <label htmlFor="wageInput" className="block text-[11px] font-medium text-zinc-500 uppercase tracking-[0.12em] mb-2.5 cursor-pointer">
              Guaranteed Registration Wage
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 f-mono text-lg pointer-events-none select-none" aria-hidden="true">$</span>
              <input id="wageInput" type="number" inputMode="numeric" min={0} placeholder="135000"
                className="w-full bg-zinc-950 border border-zinc-800/80 text-white pl-9 pr-4 py-3.5 rounded-xl text-2xl f-mono font-bold tracking-tight focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-transparent transition-all placeholder:text-zinc-800"
                value={wage}
                onChange={(e) => { const v = e.target.value; setWage(v === '' ? '' : Number(v)); }}
              />
            </div>
            <p className="text-[11px] text-zinc-700 mt-2 leading-relaxed">
              Base salary + guaranteed bonuses. RSUs and discretionary bonuses do not count.
            </p>
          </div>

          {/* Trap toggles */}
          <div className="pt-5 border-t border-zinc-800/40 space-y-3.5">
            <label htmlFor="multiSponsorToggle" className="flex items-start gap-3 cursor-pointer group">
              <input id="multiSponsorToggle" type="checkbox"
                className="mt-0.5 w-4 h-4 rounded bg-zinc-950 border-zinc-700 accent-blue-500 cursor-pointer"
                checked={hasMultipleSponsors} onChange={(e) => setHasMultipleSponsors(e.target.checked)} />
              <span className="text-[13px] text-zinc-500 group-hover:text-zinc-300 transition-colors leading-snug select-none">
                Multiple employers are submitting registrations for me
              </span>
            </label>
            <label htmlFor="outsideUsToggle" className="flex items-start gap-3 cursor-pointer group">
              <input id="outsideUsToggle" type="checkbox"
                className="mt-0.5 w-4 h-4 rounded bg-zinc-950 border-zinc-700 accent-blue-500 cursor-pointer"
                checked={isOutsideUS} onChange={(e) => setIsOutsideUS(e.target.checked)} />
              <span className="text-[13px] text-zinc-500 group-hover:text-zinc-300 transition-colors leading-snug select-none">
                I am outside the U.S. or not in valid nonimmigrant status
              </span>
            </label>
          </div>
        </section>

        {/* ── RESULTS PANEL ───────────────────────────────────────── */}
        <section className="relative border border-zinc-800/60 rounded-2xl overflow-hidden" aria-live="polite">

          {/* Clickwrap overlay */}
          {!acceptedTerms && (
            <div className="absolute inset-0 z-10 bg-zinc-950/97 backdrop-blur-lg flex flex-col justify-center items-center p-8 text-center">
              <div className="max-w-xs">
                <div className="w-11 h-11 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-6">
                  <span className="text-lg">⚖️</span>
                </div>
                <h3 className="text-[15px] font-semibold text-white mb-4 tracking-tight">Before you continue</h3>
                <div className="text-[12px] text-zinc-500 mb-7 text-left space-y-3 leading-[1.6]">
                  <p>This tool maps wages to OEWS thresholds using public data. The creators are not attorneys. This is not legal advice.</p>
                  <p>USCIS can deny or revoke petitions if it determines inputs were selected to unfairly increase selection weighting.</p>
                </div>
                <button onClick={() => setAcceptedTerms(true)}
                  className="w-full bg-white text-zinc-950 font-semibold py-3 px-4 rounded-xl text-[13px] tracking-wide hover:bg-zinc-100 transition-all active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-white/40">
                  I understand — show results
                </button>
              </div>
            </div>
          )}

          {/* Results content */}
          <div className={`p-6 md:p-10 transition-all duration-700 ${!acceptedTerms ? 'opacity-5 blur-lg select-none pointer-events-none' : 'opacity-100 blur-none'}`}>

            {/* Moat sentence */}
            <div className="text-[12px] text-zinc-500 border-l-2 border-zinc-800 pl-4 mb-10 leading-[1.65] max-w-lg">
              The wage level on your registration is derived from proffered wage vs. OEWS thresholds — it can differ from the LCA wage level label.
            </div>

            {/* ── State: no wage entered ──────────────────────────── */}
            {analysis.status === 'no_wage' ? (
              <div className="afu bg-zinc-500/5 border border-zinc-500/10 rounded-xl p-5">
                <p className="text-sm text-zinc-300 font-medium mb-1.5">Enter a wage to calculate</p>
                <p className="text-[12px] text-zinc-500 leading-relaxed">
                  Tier and probability are suppressed until a valid guaranteed wage is entered.
                </p>
              </div>

            /* ── State: no threshold data for SOC/Area ────────────── */
            ) : analysis.status === 'no_data' ? (
              <div className="afu bg-red-500/5 border border-red-500/10 rounded-xl p-5">
                <p className="text-sm text-red-400 font-medium mb-1.5">No threshold data</p>
                <p className="text-[12px] text-zinc-500 leading-relaxed">
                  SOC <span className="f-mono text-zinc-300">{socCode}</span> in area{' '}
                  <span className="f-mono text-zinc-300">{areaCode}</span> has no usable wage thresholds in this dataset.
                </p>
              </div>

            /* ── State: valid calculation ─────────────────────────── */
            ) : (
              <>
                {/* Primary result: Tier */}
                <div className="afu mb-10">
                  <div className="mb-8">
                    <p className="text-[10px] text-zinc-600 uppercase tracking-[0.2em] font-medium mb-3">Calculated Tier</p>
                    <div className="flex items-baseline gap-3">
                      <span className="text-6xl md:text-7xl font-bold text-white f-display tracking-tight leading-none">
                        {analysis.baseTier}
                      </span>
                      <span className="text-lg md:text-xl text-zinc-600 f-display italic">of 4</span>
                    </div>
                    <p className="text-[10px] text-zinc-700 mt-3 f-mono">{socCode} · {areaCode}</p>
                  </div>

                  {/* Probability + Entries */}
                  <div className="afu d1 flex flex-col sm:flex-row gap-6 sm:gap-10">
                    <div>
                      <p className="text-[10px] text-zinc-600 uppercase tracking-[0.2em] font-medium mb-2">DHS Baseline Probability</p>
                      <span className="text-3xl font-bold text-emerald-400 f-mono tracking-tight">
                        {odds ? `${odds.pct.toFixed(2)}%` : '—'}
                      </span>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-600 uppercase tracking-[0.2em] font-medium mb-2">Lottery Entries</p>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-3xl font-bold text-white f-mono tracking-tight">{odds?.entries ?? '—'}</span>
                        <span className="text-sm text-zinc-600">× weight</span>
                      </div>
                    </div>
                  </div>

                  <p className="text-[10px] text-zinc-700 mt-4 leading-relaxed max-w-sm">
                    Modeled baselines from the final rule. Actual outcomes vary with total registrations and wage-level mix.
                  </p>
                </div>

                {/* ── Diagnostics ─────────────────────────────────── */}
                <div className="space-y-3">

                  {/* Threshold analysis */}
                  {analysis.gapToNext !== null && analysis.nextThreshold !== null && (
                    <div className={`afu d2 rounded-xl p-5 ${
                      analysis.isBelowLevelOne
                        ? 'bg-red-500/[0.04] border border-red-500/10'
                        : 'bg-amber-500/[0.04] border border-amber-500/10'
                    }`}>
                      <p className={`text-[11px] font-medium uppercase tracking-wider mb-2 ${
                        analysis.isBelowLevelOne ? 'text-red-400/80' : 'text-amber-400/80'
                      }`}>
                        {analysis.isBelowLevelOne ? 'Below Level 1 Threshold' : 'Threshold Analysis'}
                      </p>
                      <p className="text-[13px] text-zinc-400 leading-[1.65]">
                        {analysis.isBelowLevelOne ? (
                          <>
                            Your wage (<span className="f-mono text-zinc-300">${numericWage.toLocaleString()}</span>) is{' '}
                            <span className="text-white font-semibold f-mono">${analysis.gapToNext.toLocaleString()}</span>{' '}
                            below the OEWS Level 1 threshold (<span className="f-mono">${analysis.nextThreshold.toLocaleString()}</span>).
                            Weighting cannot go below Level 1 (1 entry), but this is a compliance red flag.
                          </>
                        ) : (
                          <>
                            Your wage (<span className="f-mono text-zinc-300">${numericWage.toLocaleString()}</span>) is{' '}
                            <span className="text-white font-semibold f-mono">${analysis.gapToNext.toLocaleString()}</span>{' '}
                            below the Level {targetTierLabel} threshold (<span className="f-mono">${analysis.nextThreshold.toLocaleString()}</span>).
                            At or above → Level {targetTierLabel} ({WEIGHT_ENTRIES[targetTierLabel ?? 0] ?? '?'} entries).
                          </>
                        )}{' '}
                        USCIS scrutiny increases when compensation is adjusted solely to change weighting.
                      </p>
                    </div>
                  )}

                  {/* Multiple registrations */}
                  {hasMultipleSponsors && (
                    <div className="afu d3 rounded-xl p-5 bg-orange-500/[0.04] border border-orange-500/10">
                      <p className="text-[11px] font-medium text-orange-400/80 uppercase tracking-wider mb-2">Multiple Registration Impact</p>
                      <p className="text-[13px] text-zinc-400 leading-[1.65]">
                        If registrations exist at different wage levels, USCIS assigns selection weighting using the lowest equivalent wage level among them.
                        Confirm all registrations match your highest tier before {REG_CLOSE}.
                      </p>
                    </div>
                  )}

                  {/* $100K fee */}
                  {isOutsideUS && (
                    <div className="afu d4 rounded-xl p-5 bg-purple-500/[0.04] border border-purple-500/10">
                      <p className="text-[11px] font-medium text-purple-400/80 uppercase tracking-wider mb-2">$100,000 Payment Warning</p>
                      <p className="text-[13px] text-zinc-400 leading-[1.65]">
                        The Sept 19, 2025 Presidential Proclamation establishes a $100,000 payment for certain new H-1B petitions
                        involving beneficiaries outside the U.S. Counsel should confirm applicability, exemptions, and current effective status.
                      </p>
                    </div>
                  )}
                </div>

                {/* Memo button */}
                <div className="mt-10 pt-8 border-t border-zinc-800/30">
                  <button
                    onClick={() => { void generateMemo(); }}
                    disabled={analysis.status !== 'ok'}
                    className={`w-full font-semibold py-3.5 px-4 rounded-xl text-[13px] tracking-wide transition-all duration-300 flex justify-center items-center gap-2 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-zinc-950 ${
                      memoStatus === 'copied'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 focus:ring-emerald-500/30'
                        : memoStatus === 'failed'
                          ? 'bg-red-500/10 text-red-400 border border-red-500/20 focus:ring-red-500/30'
                          : 'bg-white text-zinc-950 hover:bg-zinc-100 focus:ring-white/40'
                    }`}>
                    {memoStatus === 'copied'
                      ? '✓ Copied to clipboard'
                      : memoStatus === 'failed'
                        ? 'Copy failed — try again'
                        : 'Generate memo for HR & counsel'}
                  </button>
                  <p className="text-center text-[10px] text-zinc-700 mt-3 leading-relaxed">
                    Plain-text memo with SOC/Area, wage level, baseline probability, and applicable diagnostics.
                  </p>
                </div>
              </>
            )}
          </div>
        </section>

        {/* ── FOOTER ──────────────────────────────────────────────── */}
        <footer className="mt-12 pt-6 border-t border-zinc-800/20 space-y-2">
          <p className="text-[10px] text-zinc-700 leading-relaxed">
            Not affiliated with USCIS, DHS, DOL, or OFLC. Baselines are DHS model outputs;
            actual FY2027 outcomes depend on registration volume and wage-level distribution.
          </p>
          <div className="text-[10px] text-zinc-700 flex flex-wrap gap-x-3 gap-y-1">
            <a className="underline underline-offset-2 hover:text-zinc-400 transition-colors"
              href="https://www.uscis.gov/newsroom/alerts/fy-2027-h-1b-cap-initial-registration-period-opens-on-march-4"
              target="_blank" rel="noreferrer">
              USCIS FY2027 registration window
            </a>
            <a className="underline underline-offset-2 hover:text-zinc-400 transition-colors"
              href="https://www.federalregister.gov/documents/2025/12/29/2025-23853/weighted-selection-process-for-registrants-and-petitioners-seeking-to-file-cap-subject-h-1b"
              target="_blank" rel="noreferrer">
              Federal Register final rule (Dec 29, 2025)
            </a>
          </div>
          <p className="text-[10px] text-zinc-800">© 2026 wagelevel.fyi · All times Eastern.</p>
        </footer>
      </div>
    </div>
  );
}
