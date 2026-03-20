export default async function handler(req: any, res: any) {
  try {
    const url = new URL("https://api.energyzero.nl/v1/energyprices");
    const params = ["fromDate", "tillDate", "interval", "usageType", "inclBtw"];

    for (const key of params) {
      const value = req.query?.[key];
      if (typeof value === "string" && value.length > 0) {
        url.searchParams.set(key, value);
      }
    }

    if (!url.searchParams.get("interval")) url.searchParams.set("interval", "4");
    if (!url.searchParams.get("usageType")) url.searchParams.set("usageType", "1");
    if (!url.searchParams.get("inclBtw")) url.searchParams.set("inclBtw", "true");

    const upstream = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    const text = await upstream.text();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(upstream.status).send(text);
  } catch (error: any) {
    res.status(500).json({
      error: "Proxy request failed",
      details: error?.message ?? "Unknown error",
    });
  }
}
