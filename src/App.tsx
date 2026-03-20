import React, { useEffect, useMemo, useState } from "react";
import { RefreshCw, AlertCircle, Clock3, TrendingDown, TrendingUp } from "lucide-react";

const TZ = "Europe/Amsterdam";
const API_BASE = "/api/prices";
const MISSING_COLOR = "#E5E7EB";

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

function formatDateInput(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatEuro(value: number | null, digits = 4) {
  if (value == null || Number.isNaN(value)) return "–";
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

async function fetchEnergyPrices(dateString: string): Promise<ApiPrice[]> {
  const { fromDate, tillDate } = localDateRangeToIso(dateString);
  const url = new URL(API_BASE, window.location.origin);
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
    .map((item: any) => ({ readingDate: item.readingDate, price: item.price }));
}

async function fetchUpcomingWindowPrices(dateKey: string): Promise<ApiPrice[]> {
  const tomorrow = addDays(dateKey, 1);
  const [todayPrices, tomorrowPrices] = await Promise.all([
    fetchEnergyPrices(dateKey),
    fetchEnergyPrices(tomorrow),
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

function currentHourInAmsterdam(now: Date) {
  return getDatePartsInTZ(now, TZ).hour;
}

function analogHands(now: Date) {
  const parts = getDatePartsInTZ(now, TZ);
  const hour12 = parts.hour % 12;
  const minuteAngle = parts.minute * 6 + parts.second * 0.1;
  const hourAngle = hour12 * 30 + parts.minute * 0.5;
  const secondAngle = parts.second * 6;
  return { hourAngle, minuteAngle, secondAngle, parts };
}

function getHourSectorAngles(hour24: number) {
  const start = (hour24 % 12) * 30;
  const end = start + 30;
  const center = start + 15;
  return { start, end, center };
}

function runSelfTests() {
  const sampleHours: DateHourMap = {
    [makeDateHourKey("2026-03-19", 23)]: { hour: 23, value: 0.25, count: 1, points: [] },
    [makeDateHourKey("2026-03-20", 0)]: { hour: 0, value: 0.11, count: 1, points: [] },
    [makeDateHourKey("2026-03-20", 1)]: { hour: 1, value: 0.12, count: 1, points: [] },
  };

  const ring = buildUpcomingRing(sampleHours, new Date("2026-03-19T22:15:00Z"));
  const emptyRing = buildUpcomingRing({}, new Date("2026-03-19T10:15:00Z"));

  const checks: Array<[string, boolean]> = [
    ["formatDateInput formats date", formatDateInput(new Date("2026-03-19T12:00:00Z")).includes("2026-")],
    ["formatEuro handles null", formatEuro(null) === "–"],
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
  const handSecondEnd = linePoint(center, center, 130, hands.secondAngle);

  return (
    <div className="flex flex-col items-center gap-4">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[560px] drop-shadow-sm">
        {slices.map((slice, index) => {
          const { start, end, center: sectorCenter } = getHourSectorAngles(slice.hour);
          const fill = colorForValue(slice.value, min, max);
          const path = donutPath(center, center, outerRadius, innerRadius, start, end);
          const textPos = polar(center, center, (outerRadius + innerRadius) / 2, sectorCenter);
          const dayPos = polar(center, center, outerRadius + 24, sectorCenter);

          return (
            <g key={`${slice.dateKey}-${slice.hour}-${index}`}>
              <path
                d={path}
                fill={fill}
                stroke={slice.isCurrentHour ? "#0F172A" : "white"}
                strokeWidth={slice.isCurrentHour ? 5 : 3}
              />
              <text x={textPos.x} y={textPos.y + 5} textAnchor="middle" className="fill-slate-900 text-[16px] font-bold">
                {slice.label}
              </text>
              <text x={dayPos.x} y={dayPos.y + 4} textAnchor="middle" className="fill-slate-400 text-[10px] font-semibold">
                {slice.dateKey.slice(8, 10)}
              </text>
            </g>
          );
        })}

        <circle cx={center} cy={center} r={138} fill="white" stroke="#CBD5E1" strokeWidth="3" />
        <circle cx={center} cy={center} r={8} fill="#0F172A" />

        {hourNumbers.map((item) => (
          <text key={item.analog} x={item.x} y={item.y + 5} textAnchor="middle" className="fill-slate-500 text-[20px] font-semibold">
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

        <line x1={center} y1={center} x2={handHourEnd.x} y2={handHourEnd.y} stroke="#0F172A" strokeWidth="7" strokeLinecap="round" />
        <line x1={center} y1={center} x2={handMinuteEnd.x} y2={handMinuteEnd.y} stroke="#334155" strokeWidth="4" strokeLinecap="round" />
        <line x1={center} y1={center} x2={handSecondEnd.x} y2={handSecondEnd.y} stroke="#DC2626" strokeWidth="2" strokeLinecap="round" />

        <text x={center} y={center - 28} textAnchor="middle" className="fill-slate-900 text-[18px] font-bold">
          Komende 12 uur
        </text>
        <text x={center} y={center - 4} textAnchor="middle" className="fill-slate-500 text-[12px]">
          Het actuele uur staat op zijn echte klokpositie
        </text>
        <text x={center} y={center + 18} textAnchor="middle" className="fill-slate-500 text-[12px]">
          Lichtgrijs = nog geen prijs bekend
        </text>
        <text x={center} y={center + 44} textAnchor="middle" className="fill-slate-900 text-[22px] font-bold">
          {String(hands.parts.hour).padStart(2, "0")}:{String(hands.parts.minute).padStart(2, "0")}
        </text>
      </svg>
    </div>
  );
}

export default function DynamicEnergyClockApp() {
  const [now, setNow] = useState(new Date());
  const [prices, setPrices] = useState<ApiPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
      setError(err?.message || "De prijsfeed kon niet direct worden geladen. Controleer of de Vercel API-route /api/prices werkt.");
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
  const activeHour = currentHourInAmsterdam(now);
  const missingCount = slices.filter((s) => s.value == null).length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Nederlandse dynamische stroomprijzen</div>
            <h1 className="text-3xl font-bold tracking-tight">Analoge prijs-klok</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              De klok toont altijd de komende 12 uur op echte klokposities. Elk heel uur schuift het venster door. Ontbrekende prijzen blijven lichtgrijs totdat ze bekend zijn.
            </p>
          </div>

          <button onClick={() => load(todayKey)} className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Vernieuwen
          </button>
        </div>

        {error && (
          <div className="mb-6 flex items-start gap-3 rounded-3xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <div className="font-semibold">Ophalen is niet gelukt</div>
              <div className="text-sm">{error}</div>
            </div>
          </div>
        )}

        <div className="mb-6 grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-slate-500">
              <TrendingDown className="h-4 w-4" />
              <span className="text-sm font-medium">Goedkoopste uur</span>
            </div>
            <div className="text-2xl font-bold">{cheapest ? `${cheapest.label}:00` : "–"}</div>
            <div className="mt-1 text-sm text-slate-600">{cheapest ? formatEuro(cheapest.value) : "Geen data"}</div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-slate-500">
              <TrendingUp className="h-4 w-4" />
              <span className="text-sm font-medium">Duurste uur</span>
            </div>
            <div className="text-2xl font-bold">{mostExpensive ? `${mostExpensive.label}:00` : "–"}</div>
            <div className="mt-1 text-sm text-slate-600">{mostExpensive ? formatEuro(mostExpensive.value) : "Geen data"}</div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-slate-500">
              <Clock3 className="h-4 w-4" />
              <span className="text-sm font-medium">Nu in Amsterdam</span>
            </div>
            <div className="text-2xl font-bold">{String(activeHour).padStart(2, "0")}:00</div>
            <div className="mt-1 text-sm text-slate-600">Donker omlijnd segment = dit uur</div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-2 text-sm font-medium text-slate-500">Laatste update</div>
            <div className="text-lg font-bold">{lastUpdated ?? "–"}</div>
            <div className="mt-1 text-sm text-slate-600">{missingCount} uur zonder prijs</div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">Komende 12 uur op één klok</h2>
                <p className="text-sm text-slate-600">Groen is goedkoop, rood is duur. Elk uur schuift het venster automatisch door naar het volgende uur.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 px-3 py-2 text-xs text-slate-500">
                schaal: {formatEuro(min)} → {formatEuro(max)}
              </div>
            </div>

            <AnalogPriceClock slices={slices} min={min} max={max} now={now} />
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-xl font-bold">Komende 12 uur</h2>
            <div className="space-y-2">
              {slices.map((slice, index) => {
                const bg = colorForValue(slice.value, min, max);
                return (
                  <div
                    key={`${slice.dateKey}-${slice.hour}-${index}`}
                    className={`flex items-center justify-between rounded-2xl border px-3 py-2 ${index === 0 ? "border-slate-900" : "border-slate-200"}`}
                    style={{ backgroundColor: bg }}
                  >
                    <div>
                      <div className="font-semibold">{slice.label}:00</div>
                      <div className="text-xs text-slate-600">{slice.dateKey}</div>
                    </div>
                    <div className="text-sm font-medium">{formatEuro(slice.value)}</div>
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
