import React, { useEffect, useMemo, useState } from "react";
import { RefreshCw, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";

const TZ = "Europe/Amsterdam";
const API_BASE = "/api/prices";
const MISSING_COLOR = "#E5E7EB";
const TIBBER_PURCHASE_FEE_INCL_VAT = 0.0248;
const ELECTRICITY_TAX_INCL_VAT = 0.1108;

type ApiPrice = {
  price: number;
  readingDate: string;
};

type HourPoint = {
  hour: number;
  value: number;
  count: number;
  points: ApiPrice[];
};

type RingSlice = {
  label: string;
  value: number | null;
  hour: number;
  dateKey: string;
  isCurrentHour: boolean;
};

type DateHourMap = Record<string, HourPoint>;

function tibberVariablePriceInclVat(baseMarketPrice: number) {
  return baseMarketPrice + TIBBER_PURCHASE_FEE_INCL_VAT + ELECTRICITY_TAX_INCL_VAT;
}

function formatDateInput(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatEuro(value: number | null, digits = 4) {
  if (value == null || Number.isNaN(value)) return "Nog niet bekend";
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function getDatePartsInTZ(date: Date, timeZone = TZ) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

function localDateRangeToIso(dateString: string) {
  const [y, m, d] = dateString.split("-").map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return {
    fromDate: start.toISOString(),
    tillDate: new Date(end.getTime() - 1).toISOString(),
  };
}

function addDays(dateString: string, days: number) {
  const [y, m, d] = dateString.split("-").map(Number);
  const date = new Date(y, m - 1, d + days, 12, 0, 0, 0);
  return formatDateInput(date);
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function colorForValue(value: number | null, min: number, max: number) {
  if (value == null || Number.isNaN(value)) return MISSING_COLOR;
  if (max <= min) return "hsl(120 55% 72%)";
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const hue = 120 - t * 120;
  const lightness = 78 - t * 32;
  const saturation = 62 + t * 8;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function donutPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startDeg: number,
  endDeg: number
) {
  const outerStart = polar(cx, cy, rOuter, startDeg);
  const outerEnd = polar(cx, cy, rOuter, endDeg);
  const innerStart = polar(cx, cy, rInner, startDeg);
  const innerEnd = polar(cx, cy, rInner, endDeg);
  const largeArc = endDeg - startDeg <= 180 ? 0 : 1;

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

function linePoint(cx: number, cy: number, r: number, angleDeg: number) {
  return polar(cx, cy, r, angleDeg);
}

function makeDateHourKey(dateKey: string, hour: number) {
  return `${dateKey}-${hour}`;
}

async function fetchEnergyZeroPrices(dateString: string): Promise<ApiPrice[]> {
  const { fromDate, tillDate } = localDateRangeToIso(dateString);
  const url = new URL(API_BASE);
  url.searchParams.set("fromDate", fromDate);
  url.searchParams.set("tillDate", tillDate);
  url.searchParams.set("interval", "4");
  url.searchParams.set("usageType", "1");
  url.searchParams.set("inclBtw", "true");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Ophalen mislukt (${res.status})`);
  }

  const data = await res.json();
  const raw = Array.isArray(data?.Prices)
    ? data.Prices
    : Array.isArray(data?.prices)
      ? data.prices
      : [];

  return raw
    .filter((item: any) => item && typeof item.readingDate === "string" && typeof item.price === "number")
    .map((item: any) => ({
      readingDate: item.readingDate,
      price: tibberVariablePriceInclVat(item.price),
    }));
}

async function fetchUpcomingWindowPrices(dateKey: string): Promise<ApiPrice[]> {
  const tomorrow = addDays(dateKey, 1);
  const [todayPrices, tomorrowPrices] = await Promise.all([
    fetchEnergyZeroPrices(dateKey),
    fetchEnergyZeroPrices(tomorrow),
  ]);
  return [...todayPrices, ...tomorrowPrices];
}

function aggregateByDateHour(prices: ApiPrice[]) {
  const map = new Map<string, HourPoint>();

  for (const p of prices) {
    const parts = getDatePartsInTZ(new Date(p.readingDate), TZ);
    const key = makeDateHourKey(parts.dateKey, parts.hour);
    const existing = map.get(key) ?? {
      hour: parts.hour,
      value: 0,
      count: 0,
      points: [],
    };

    existing.value += p.price;
    existing.count += 1;
    existing.points.push(p);
    map.set(key, existing);
  }

  const result: DateHourMap = {};
  map.forEach((point, key) => {
    result[key] = {
      ...point,
      value: point.value / point.count,
    };
  });
  return result;
}

function buildUpcomingRing(hourMap: DateHourMap, now: Date): RingSlice[] {
  const currentParts = getDatePartsInTZ(now, TZ);
  const currentHourStart = new Date(now);
  currentHourStart.setMinutes(0, 0, 0);

  return Array.from({ length: 12 }, (_, index) => {
    const sliceDate = addHours(currentHourStart, index);
    const parts = getDatePartsInTZ(sliceDate, TZ);
    const key = makeDateHourKey(parts.dateKey, parts.hour);
    const point = hourMap[key];

    return {
      label: String(parts.hour).padStart(2, "0"),
      value: point && Number.isFinite(point.value) ? point.value : null,
      hour: parts.hour,
      dateKey: parts.dateKey,
      isCurrentHour: index === 0 && parts.hour === currentParts.hour,
    };
  });
}

function analogHands(now: Date) {
  const parts = getDatePartsInTZ(now, TZ);
  const hour12 = parts.hour % 12;
  const minuteAngle = parts.minute * 6 + parts.second * 0.1;
  const hourAngle = hour12 * 30 + parts.minute * 0.5;
  return { hourAngle, minuteAngle };
}

function getHourSectorAngles(hour24: number) {
  const start = (hour24 % 12) * 30;
  const end = start + 30;
  const center = start + 15;
  return { start, end, center };
}

function formatSliceSubLabel(slice: RingSlice, index: number, todayKey: string) {
  if (index === 0) return "Nu";
  return slice.dateKey === todayKey ? "Vandaag" : "Morgen";
}

function runSelfTests() {
  const sampleHours: DateHourMap = {
    [makeDateHourKey("2026-03-19", 23)]: { hour: 23, value: tibberVariablePriceInclVat(0.25), count: 1, points: [] },
    [makeDateHourKey("2026-03-20", 0)]: { hour: 0, value: tibberVariablePriceInclVat(0.11), count: 1, points: [] },
    [makeDateHourKey("2026-03-20", 1)]: { hour: 1, value: tibberVariablePriceInclVat(0.12), count: 1, points: [] },
  };

  const ring = buildUpcomingRing(sampleHours, new Date("2026-03-19T22:15:00Z"));
  const emptyRing = buildUpcomingRing({}, new Date("2026-03-19T10:15:00Z"));

  const checks: Array<[string, boolean]> = [
    ["tibber price adds fee and tax", tibberVariablePriceInclVat(0.1) === 0.2356],
    ["formatDateInput formats date", formatDateInput(new Date("2026-03-19T12:00:00Z")).includes("2026-")],
    ["formatEuro handles null", formatEuro(null) === "Nog niet bekend"],
    ["colorForValue handles missing", colorForValue(null, 0, 1) === MISSING_COLOR],
    ["donutPath returns svg path", donutPath(100, 100, 80, 50, -15, 15).includes("A 80 80")],
    ["addDays increments date", addDays("2026-03-19", 1) === "2026-03-20"],
    ["addHours increments time", addHours(new Date("2026-03-19T22:00:00Z"), 2).toISOString() === "2026-03-20T00:00:00.000Z"],
    ["upcoming ring has 12 slices", ring.length === 12],
    ["upcoming ring starts at current hour", ring[0].hour === 23],
    ["upcoming ring crosses midnight", ring[1].hour === 0],
    ["upcoming ring changes date after midnight", ring[1].dateKey === "2026-03-20"],
    ["missing hour returns null value", emptyRing[0].value === null],
    ["midnight sector starts at 12 o'clock", getHourSectorAngles(0).start === 0],
    ["13:00 sector maps to 1 o'clock", getHourSectorAngles(13).start === 30],
    ["23:00 sector center is between 11 and 12", getHourSectorAngles(23).center === 345],
    ["sub label now works", formatSliceSubLabel(ring[0], 0, "2026-03-19") === "Nu"],
  ];

  const failed = checks.filter(([, ok]) => !ok);
  if (failed.length > 0) {
    throw new Error(`Self test failed: ${failed.map(([name]) => name).join(", ")}`);
  }
}

runSelfTests();

function AnalogPriceClock({
  slices,
  min,
  max,
  now,
}: {
  slices: RingSlice[];
  min: number;
  max: number;
  now: Date;
}) {
  const size = 560;
  const center = size / 2;
  const outerRadius = 230;
  const innerRadius = 145;
  const hands = analogHands(now);

  const hourNumbers = Array.from({ length: 12 }, (_, i) => {
    const analog = i === 0 ? 12 : i;
    const pos = polar(center, center, 118, i * 30);
    return { analog, x: pos.x, y: pos.y };
  });

  const handHourEnd = linePoint(center, center, 85, hands.hourAngle);
  const handMinuteEnd = linePoint(center, center, 120, hands.minuteAngle);

  return (
    <div className="flex flex-col items-center gap-4">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[560px] drop-shadow-sm">
        {slices.map((slice, index) => {
          const { start, end, center: sectorCenter } = getHourSectorAngles(slice.hour);
          const fill = colorForValue(slice.value, min, max);
          const path = donutPath(center, center, outerRadius, innerRadius, start, end);
          const textPos = polar(center, center, (outerRadius + innerRadius) / 2, sectorCenter);

          return (
            <g key={`${slice.dateKey}-${slice.hour}-${index}`}>
              <path
                d={path}
                fill={fill}
                stroke={slice.isCurrentHour ? "#0F172A" : "white"}
                strokeWidth={slice.isCurrentHour ? 5 : 3}
              />
              <text
                x={textPos.x}
                y={textPos.y + 5}
                textAnchor="middle"
                className="fill-slate-900 text-[16px] font-bold"
              >
                {slice.label}
              </text>
            </g>
          );
        })}

        <circle cx={center} cy={center} r={138} fill="white" stroke="#CBD5E1" strokeWidth="3" />
        <circle cx={center} cy={center} r={8} fill="#0F172A" />

        {hourNumbers.map((item) => (
          <text
            key={item.analog}
            x={item.x}
            y={item.y + 5}
            textAnchor="middle"
            className="fill-slate-500 text-[20px] font-semibold"
          >
            {item.analog}
          </text>
        ))}

        {Array.from({ length: 60 }, (_, i) => {
          const outer = polar(center, center, i % 5 === 0 ? 136 : 132, i * 6);
          const inner = polar(center, center, i % 5 === 0 ? 126 : 128, i * 6);
          return (
            <line
              key={i}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke={i % 5 === 0 ? "#94A3B8" : "#CBD5E1"}
              strokeWidth={i % 5 === 0 ? 2.5 : 1.2}
              strokeLinecap="round"
            />
          );
        })}

        <line
          x1={center}
          y1={center}
          x2={handHourEnd.x}
          y2={handHourEnd.y}
          stroke="#0F172A"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <line
          x1={center}
          y1={center}
          x2={handMinuteEnd.x}
          y2={handMinuteEnd.y}
          stroke="#334155"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

export default function DynamicEnergyClockApp() {
  const [now, setNow] = useState(new Date());
  const [prices, setPrices] = useState<ApiPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const nowParts = useMemo(() => getDatePartsInTZ(now, TZ), [now]);
  const todayKey = nowParts.dateKey;

  async function load(baseDateKey = todayKey) {
    setLoading(true);
    setError(null);

    try {
      const result = await fetchUpcomingWindowPrices(baseDateKey);
      setPrices(result);
      setLastUpdated(new Date().toLocaleString("nl-NL", { timeZone: TZ }));
    } catch (err: any) {
      setError(
        err?.message ||
          "De prijsfeed kon niet direct worden geladen. Mogelijk blokkeert de browser cross-origin requests."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(todayKey);
    const id = window.setInterval(() => load(getDatePartsInTZ(new Date(), TZ).dateKey), 15 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [todayKey]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const hourMap = useMemo(() => aggregateByDateHour(prices), [prices]);
  const slices = useMemo(() => buildUpcomingRing(hourMap, now), [hourMap, now]);
  const validValues = slices.map((s) => s.value).filter((v) => v != null && Number.isFinite(v)) as number[];
  const min = validValues.length ? Math.min(...validValues) : 0;
  const max = validValues.length ? Math.max(...validValues) : 1;
  const cheapest = slices.filter((s) => s.value != null).sort((a, b) => (a.value as number) - (b.value as number))[0];
  const mostExpensive = slices.filter((s) => s.value != null).sort((a, b) => (b.value as number) - (a.value as number))[0];
  const missingCount = slices.filter((s) => s.value == null).length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-6xl px-6 py-8">
        {error && (
          <div className="mb-6 flex items-start gap-3 rounded-3xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <div className="font-semibold">Ophalen is niet gelukt</div>
              <div className="text-sm">
                {error} Als dit in een gewone browser gebeurt, dan is de kans groot dat er een kleine proxy of serverless functie tussen moet.
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="max-w-3xl">
                <h1 className="text-2xl font-bold tracking-tight">Tibber Energieprijzen komende 12 uur</h1>
                <p className="mt-2 text-sm text-slate-600">
                  Groen is goedkoop, rood is duur. Elk uur schuift het venster automatisch door naar het volgende uur.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setShowDetails((prev) => !prev)}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                  {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  {showDetails ? "Minder info" : "Meer info"}
                </button>
                <button
                  onClick={() => load(todayKey)}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                  Vernieuwen
                </button>
              </div>
            </div>

            {showDetails && (
              <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-500">Goedkoopste uur</div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">{cheapest ? `${cheapest.label}:00` : "–"}</div>
                  <div className="mt-1 text-sm text-slate-600">{cheapest ? formatEuro(cheapest.value, 4) : "Geen data"}</div>
                  <div className="mt-1 text-xs text-slate-500">Variabele Tibber-prijs</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-500">Duurste uur</div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">{mostExpensive ? `${mostExpensive.label}:00` : "–"}</div>
                  <div className="mt-1 text-sm text-slate-600">{mostExpensive ? formatEuro(mostExpensive.value, 4) : "Geen data"}</div>
                  <div className="mt-1 text-xs text-slate-500">Variabele Tibber-prijs</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-500">Nu in Amsterdam</div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">{String(nowParts.hour).padStart(2, "0")}:00</div>
                  <div className="mt-1 text-sm text-slate-600">Donker omlijnd segment = dit uur</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-500">Laatste update</div>
                  <div className="mt-2 text-lg font-bold text-slate-900">{lastUpdated ?? "–"}</div>
                  <div className="mt-1 text-sm text-slate-600">{missingCount} uur zonder prijs</div>
                  <div className="mt-1 text-xs text-slate-500">Excl. netbeheer en €5,99 p/m</div>
                </div>
              </div>
            )}

            <AnalogPriceClock slices={slices} min={min} max={max} now={now} />
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-xl font-bold">Uren en prijzen</h2>
            <p className="mb-4 text-sm text-slate-600">Van nu tot 12 uur vooruit.</p>
            <p className="mb-4 text-xs text-slate-500">Alle bedragen zijn Tibber variabele prijzen incl. energiebelasting, btw en inkoopvergoeding.</p>
            <div className="space-y-2">
              {slices.map((slice, index) => {
                const bg = colorForValue(slice.value, min, max);
                return (
                  <div
                    key={`${slice.dateKey}-${slice.hour}-${index}`}
                    className={`flex items-center justify-between rounded-2xl border px-3 py-2 ${
                      index === 0 ? "border-slate-900" : "border-slate-200"
                    }`}
                    style={{ backgroundColor: bg }}
                  >
                    <div>
                      <div className="font-semibold">{slice.label}:00</div>
                      <div className="text-xs text-slate-600">{formatSliceSubLabel(slice, index, todayKey)}</div>
                    </div>
                    <div className="text-sm font-medium">{formatEuro(slice.value, 4)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
