/* ==========================================================================
   Junakartta – Digitraffic-rajapintakerros
   Lähde: Fintraffic / digitraffic.fi (CC BY 4.0)
   https://www.digitraffic.fi/rautatieliikenne/
   ========================================================================== */

const API = (() => {
  const BASE = "https://rata.digitraffic.fi";
  const GRAPHQL_URL = BASE + "/api/v2/graphql/graphql";
  const APP_ID = "junakartta/1.0";
  const MOCK = new URLSearchParams(location.search).has("mock");

  /* ---------- HTTP ---------- */

  async function fetchJSON(url, options = {}, withUserHeader = true) {
    const headers = Object.assign({}, options.headers);
    if (withUserHeader) headers["Digitraffic-User"] = APP_ID;
    try {
      const res = await fetch(url, Object.assign({}, options, { headers }));
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (err) {
      // Jos mukautettu otsake kaataa CORS-esitarkistuksen, yritetään ilman sitä.
      if (err instanceof TypeError && withUserHeader) {
        return fetchJSON(url, options, false);
      }
      throw err;
    }
  }

  async function graphql(query) {
    const data = await fetchJSON(GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (data.errors && data.errors.length) {
      throw new Error("GraphQL: " + data.errors[0].message);
    }
    return data.data;
  }

  /* ---------- Rajapintakutsut ---------- */

  // Junien viimeisimmät GPS-sijainnit: [{trainNumber, departureDate, timestamp,
  // location:{coordinates:[lon,lat]}, speed, accuracy}]
  async function getTrainLocations() {
    if (MOCK) return mockLocations();
    return fetchJSON(BASE + "/api/v1/train-locations/latest");
  }

  // Kulussa olevien junien aikataulu- ja perustiedot (GraphQL v2).
  async function getRunningTrains() {
    if (MOCK) return mockTrains();
    const q = `{
      currentlyRunningTrains {
        trainNumber
        departureDate
        cancelled
        commuterLineid
        trainType { name trainCategory { name } }
        operator { shortCode name }
        timeTableRows {
          type
          trainStopping
          cancelled
          scheduledTime
          actualTime
          liveEstimateTime
          differenceInMinutes
          station { name shortCode }
        }
      }
    }`;
    const data = await graphql(q);
    return data.currentlyRunningTrains || [];
  }

  // Asemien metatiedot (nimi, sijainti, matkustajaliikenne).
  async function getStations() {
    if (MOCK) return [];
    return fetchJSON(BASE + "/api/v1/metadata/stations");
  }

  /* ---------- Apufunktiot ---------- */

  const timeFmt = new Intl.DateTimeFormat("fi-FI", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Helsinki",
  });
  const clockFmt = new Intl.DateTimeFormat("fi-FI", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Helsinki",
  });

  function fmtTime(iso) {
    if (!iso) return "–";
    return timeFmt.format(new Date(iso));
  }
  function fmtClock(date) {
    return clockFmt.format(date || new Date());
  }

  function stationName(st) {
    if (!st || !st.name) return "?";
    return st.name.replace(/ asema$/i, "").replace(/_/g, " ");
  }

  function trainKey(t) {
    return t.departureDate + ":" + t.trainNumber;
  }

  // Kategoria Digitrafficin trainCategory-arvosta.
  function categoryOf(train) {
    const c = train.trainType && train.trainType.trainCategory
      ? train.trainType.trainCategory.name : "";
    if (c === "Commuter") return "lahi";
    if (c === "Long-distance") return "kauko";
    if (c === "Cargo") return "tavara";
    return "muu";
  }

  const CATEGORY_LABELS = {
    kauko: "Kaukojuna",
    lahi: "Lähijuna",
    tavara: "Tavarajuna",
    muu: "Muu",
  };

  // Lyhyt nimi: "IC 27", "U" (lähijunan linjatunnus) tai "T 5504".
  function shortTitle(train) {
    if (train.commuterLineid) return train.commuterLineid;
    const type = train.trainType ? train.trainType.name : "";
    return (type + " " + train.trainNumber).trim();
  }

  // Pitkä nimi: "IC 27" / "U-juna 8555".
  function longTitle(train) {
    if (train.commuterLineid) {
      return train.commuterLineid + "-juna " + train.trainNumber;
    }
    return shortTitle(train);
  }

  // Lähtö- ja pääteasema aikataulurivien perusteella.
  function route(train) {
    const rows = train.timeTableRows || [];
    if (!rows.length) return { from: "?", to: "?" };
    return {
      from: stationName(rows[0].station),
      to: stationName(rows[rows.length - 1].station),
    };
  }

  // Viimeisin toteutunut myöhästyminen minuutteina (+ myöhässä, − etuajassa).
  function delayOf(train) {
    const rows = train.timeTableRows || [];
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].actualTime != null && rows[i].differenceInMinutes != null) {
        return rows[i].differenceInMinutes;
      }
    }
    // Ei vielä toteumaa – käytetään ensimmäistä arviota, jos on.
    for (const r of rows) {
      if (r.differenceInMinutes != null) return r.differenceInMinutes;
    }
    return 0;
  }

  // Seuraava pysähdys: {name, time} tai null.
  function nextStop(train) {
    const rows = train.timeTableRows || [];
    for (const r of rows) {
      if (r.actualTime == null && !r.cancelled && r.trainStopping !== false && r.type === "ARRIVAL") {
        return { name: stationName(r.station), time: r.liveEstimateTime || r.scheduledTime };
      }
    }
    return null;
  }

  function delayBadge(train) {
    if (train.cancelled) return { cls: "badge-cancelled", text: "Peruttu" };
    const d = delayOf(train);
    if (d <= 0) return { cls: "badge-ontime", text: d < 0 ? "Etuajassa " + Math.abs(d) + " min" : "Ajallaan" };
    if (d <= 5) return { cls: "badge-slight", text: "+" + d + " min" };
    if (d <= 15) return { cls: "badge-late", text: "+" + d + " min" };
    return { cls: "badge-verylate", text: "+" + d + " min" };
  }

  /* ---------- Mock-tila kehitystä varten (?mock) ---------- */

  const MOCK_TRAINS = [
    { n: 27, type: "IC", cat: "Long-distance", from: "Helsinki asema", to: "Oulu asema", path: [[24.941, 60.172], [25.7, 62.24], [27.68, 62.89], [25.5, 64.0], [25.486, 65.012]], speed: 143, delay: 2 },
    { n: 81, type: "S", cat: "Long-distance", from: "Helsinki asema", to: "Kuopio asema", path: [[24.941, 60.172], [26.7, 60.87], [27.27, 61.69], [27.678, 62.892]], speed: 178, delay: 12 },
    { n: 8555, type: "HL", cat: "Commuter", line: "U", from: "Helsinki asema", to: "Kirkkonummi asema", path: [[24.941, 60.172], [24.6, 60.21], [24.44, 60.13]], speed: 89, delay: 0 },
    { n: 9701, type: "HL", cat: "Commuter", line: "I", from: "Helsinki asema", to: "Helsinki asema", path: [[24.941, 60.172], [25.05, 60.3], [24.941, 60.172]], speed: 62, delay: 1 },
    { n: 5504, type: "T", cat: "Cargo", from: "Tampere asema", to: "Kouvola asema", path: [[23.774, 61.498], [24.8, 61.13], [26.704, 60.866]], speed: 74, delay: -3 },
    { n: 141, type: "IC", cat: "Long-distance", from: "Helsinki asema", to: "Rovaniemi asema", path: [[24.941, 60.172], [23.774, 61.498], [25.486, 65.012], [25.72, 66.497]], speed: 0, delay: 27 },
    { n: 421, type: "PYO", cat: "Long-distance", from: "Turku satama", to: "Joensuu asema", path: [[22.22, 60.44], [23.774, 61.498], [29.77, 62.6]], speed: 121, delay: 6 },
    { n: 61234, type: "SAA", cat: "Shunting", from: "Kouvola asema", to: "Kouvola asema", path: [[26.704, 60.866], [26.75, 60.88]], speed: 18, delay: 0 },
  ];

  function mockPos(t, nowMs) {
    // Kuljetaan reittiä edestakaisin ~40 minuutin jaksolla.
    const cycle = 2400000;
    let frac = ((nowMs + t.n * 90000) % cycle) / cycle;
    if (frac > 0.5) frac = 1 - frac;
    frac *= 2;
    const seg = Math.min(Math.floor(frac * (t.path.length - 1)), t.path.length - 2);
    const p = frac * (t.path.length - 1) - seg;
    const a = t.path[seg], b = t.path[seg + 1];
    return [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p];
  }

  const mockDate = new Date().toISOString().slice(0, 10);

  function mockLocations() {
    const now = Date.now();
    return MOCK_TRAINS.map((t) => ({
      trainNumber: t.n,
      departureDate: mockDate,
      timestamp: new Date(now).toISOString(),
      location: { type: "Point", coordinates: mockPos(t, now) },
      speed: t.speed,
    }));
  }

  function mockTrains() {
    const now = Date.now();
    return MOCK_TRAINS.map((t) => ({
      trainNumber: t.n,
      departureDate: mockDate,
      cancelled: false,
      commuterLineid: t.line || "",
      trainType: { name: t.type, trainCategory: { name: t.cat } },
      operator: { shortCode: "vr", name: "VR-Yhtymä Oyj" },
      timeTableRows: [
        { type: "DEPARTURE", trainStopping: true, cancelled: false,
          scheduledTime: new Date(now - 3600000).toISOString(),
          actualTime: new Date(now - 3600000 + t.delay * 60000).toISOString(),
          liveEstimateTime: null, differenceInMinutes: t.delay,
          station: { name: t.from, shortCode: t.from.slice(0, 3).toUpperCase() } },
        { type: "ARRIVAL", trainStopping: true, cancelled: false,
          scheduledTime: new Date(now + 3600000).toISOString(),
          actualTime: null,
          liveEstimateTime: new Date(now + 3600000 + t.delay * 60000).toISOString(),
          differenceInMinutes: t.delay,
          station: { name: t.to, shortCode: t.to.slice(0, 3).toUpperCase() } },
      ],
    }));
  }

  return {
    MOCK,
    getTrainLocations,
    getRunningTrains,
    getStations,
    fmtTime,
    fmtClock,
    stationName,
    trainKey,
    categoryOf,
    CATEGORY_LABELS,
    shortTitle,
    longTitle,
    route,
    delayOf,
    nextStop,
    delayBadge,
  };
})();
