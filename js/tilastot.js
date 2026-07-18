/* ==========================================================================
   Junakartta – tilastosivu
   Tunnusluvut ja jakaumat lasketaan livenä Digitraffic-datasta.
   ========================================================================== */

(() => {
  const REFRESH_MS = 60000;

  const tilesEl = document.getElementById("tiles");
  const errorEl = document.getElementById("error-banner");
  const updatedEl = document.getElementById("updated-note");

  const CAT_COLORS = {
    kauko: "var(--cat-kauko)",
    lahi: "var(--cat-lahi)",
    tavara: "var(--cat-tavara)",
    muu: "var(--cat-muu)",
  };

  // Nopeushistogrammin ordinaaliaskeleet (yksi sävy, vaaleasta tummaan).
  const SEQ = ["var(--seq-250)", "var(--seq-300)", "var(--seq-350)", "var(--seq-400)", "var(--seq-450)", "var(--seq-500)"];

  const ST = {
    good: "var(--st-good)",
    warn: "var(--st-warn)",
    serious: "var(--st-serious)",
    critical: "var(--st-critical)",
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function tile(label, value, unit, sub) {
    return (
      '<div class="card tile"><div class="t-label">' + label + "</div>" +
      '<div class="t-value">' + value + (unit ? '<span class="u">' + unit + "</span>" : "") + "</div>" +
      (sub ? '<div class="t-sub">' + sub + "</div>" : "") +
      "</div>"
    );
  }

  function hbars(el, rows, maxOverride) {
    const max = maxOverride || Math.max(1, ...rows.map((r) => r.value));
    el.innerHTML = rows.map((r) =>
      '<div class="hbar-row" title="' + esc(r.name) + ": " + r.value + (r.unit || "") + '">' +
      '<span class="hbar-name">' + esc(r.name) + "</span>" +
      '<div class="hbar-track"><div class="hbar-fill" style="width:' +
      Math.max(1, (r.value / max) * 100).toFixed(1) + "%;background:" + (r.color || "var(--seq-400)") + '"></div></div>' +
      '<span class="hbar-val">' + r.value + "</span></div>"
    ).join("");
  }

  function topTable(el, rows) {
    el.innerHTML = "<table class=\"top-table\"><tbody>" + rows.map((r) =>
      '<tr><td class="n"><span class="cat-dot ' + r.cat + '"></span>' + esc(r.name) + "</td>" +
      '<td class="r">' + esc(r.route) + "</td>" +
      '<td class="v">' + r.value + "</td></tr>"
    ).join("") + "</tbody></table>";
  }

  async function refresh() {
    try {
      const [trains, positions, stations] = await Promise.all([
        API.getRunningTrains(),
        API.getTrainLocations().catch(() => []),
        API.getStations().catch(() => null),
      ]);
      errorEl.classList.remove("on");
      compute(trains, positions, stations);
      updatedEl.textContent = "Päivitetty " + API.fmtClock() +
        " · luvut lasketaan kulussa olevista junista ja päivittyvät minuutin välein. " +
        "Lähde: Fintraffic / digitraffic.fi (CC BY 4.0).";
    } catch (err) {
      console.error(err);
      errorEl.classList.add("on");
    }
  }

  function compute(trains, positions, stations) {
    const speedByKey = new Map(positions.map((p) => [p.departureDate + ":" + p.trainNumber, p.speed || 0]));
    const joined = trains.map((t) => ({
      t,
      cat: API.categoryOf(t),
      delay: API.delayOf(t),
      speed: speedByKey.has(API.trainKey(t)) ? Math.round(speedByKey.get(API.trainKey(t))) : null,
    }));

    /* --- Tunnusluvut --- */

    const movingSpeeds = positions.map((p) => p.speed || 0).filter((s) => s > 0);
    const avgSpeed = movingSpeeds.length
      ? Math.round(movingSpeeds.reduce((a, b) => a + b, 0) / movingSpeeds.length) : 0;

    const withSpeed = joined.filter((j) => j.speed != null);
    const fastest = withSpeed.slice().sort((a, b) => b.speed - a.speed)[0] || null;

    const punctual = joined.filter((j) => j.delay <= 5).length;
    const punctuality = joined.length ? Math.round((punctual / joined.length) * 100) : 100;

    const lateOnes = joined.filter((j) => j.delay > 0);
    const totalLateMin = lateOnes.reduce((a, j) => a + j.delay, 0);
    const avgLate = lateOnes.length ? (totalLateMin / lateOnes.length).toFixed(1) : "0";

    const worst = joined.slice().sort((a, b) => b.delay - a.delay)[0] || null;
    const passengerStations = stations && stations.length
      ? stations.filter((s) => s.passengerTraffic).length : null;

    tilesEl.innerHTML =
      tile("Junia kulussa", positions.length || trains.length, "", "GPS-paikannettuja junia juuri nyt") +
      tile("Keskinopeus", avgSpeed, "km/h", "liikkeellä olevien junien keskiarvo") +
      tile("Kovin vauhti", fastest ? fastest.speed : "–", fastest ? "km/h" : "",
        fastest ? esc(API.longTitle(fastest.t)) + " (" + esc(API.route(fastest.t).from) + " → " + esc(API.route(fastest.t).to) + ")" : "") +
      tile("Täsmällisyys", punctuality, "%", "junista enintään 5 min myöhässä") +
      tile("Keskimyöhästyminen", avgLate, "min", "myöhässä olevien junien keskiarvo") +
      tile("Myöhästymisminuutit", totalLateMin, "min", worst && worst.delay > 0
        ? "eniten myöhässä: " + esc(API.longTitle(worst.t)) + " +" + worst.delay + " min" : "yhteensä juuri nyt") +
      (passengerStations != null ? tile("Matkustaja-asemia", passengerStations, "", "asemia rataverkolla yhteensä " + stations.length) : "");

    /* --- Junatyypit --- */

    const catCounts = { kauko: 0, lahi: 0, tavara: 0, muu: 0 };
    for (const j of joined) catCounts[j.cat]++;
    hbars(document.getElementById("chart-types"),
      Object.keys(catCounts).map((c) => ({
        name: API.CATEGORY_LABELS[c], value: catCounts[c], color: CAT_COLORS[c], unit: " junaa",
      })).sort((a, b) => b.value - a.value));

    /* --- Nopeusjakauma --- */

    const speedBins = [
      { name: "0–39 km/h", min: 0, max: 39 },
      { name: "40–79 km/h", min: 40, max: 79 },
      { name: "80–119 km/h", min: 80, max: 119 },
      { name: "120–159 km/h", min: 120, max: 159 },
      { name: "160–199 km/h", min: 160, max: 199 },
      { name: "200+ km/h", min: 200, max: Infinity },
    ];
    const speedRows = speedBins.map((b, i) => ({
      name: b.name,
      value: positions.filter((p) => (p.speed || 0) >= b.min && (p.speed || 0) <= b.max).length,
      color: SEQ[i],
      unit: " junaa",
    }));
    hbars(document.getElementById("chart-speed"), speedRows);

    /* --- Myöhästymisjakauma --- */

    const delayRows = [
      { name: "Ajallaan", value: joined.filter((j) => j.delay <= 0).length, color: ST.good, unit: " junaa" },
      { name: "1–5 min", value: joined.filter((j) => j.delay >= 1 && j.delay <= 5).length, color: ST.warn, unit: " junaa" },
      { name: "6–15 min", value: joined.filter((j) => j.delay >= 6 && j.delay <= 15).length, color: ST.serious, unit: " junaa" },
      { name: "Yli 15 min", value: joined.filter((j) => j.delay > 15).length, color: ST.critical, unit: " junaa" },
    ];
    hbars(document.getElementById("chart-delays"), delayRows);

    /* --- Operaattorit --- */

    const ops = new Map();
    for (const j of joined) {
      const op = j.t.operator ? (j.t.operator.shortCode || "?").toUpperCase() : "?";
      ops.set(op, (ops.get(op) || 0) + 1);
    }
    hbars(document.getElementById("chart-operators"),
      [...ops.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([name, value]) => ({ name, value, unit: " junaa" })));

    /* --- Top-listat --- */

    topTable(document.getElementById("top-fastest"),
      withSpeed.slice().sort((a, b) => b.speed - a.speed).slice(0, 5).map((j) => {
        const r = API.route(j.t);
        return { name: API.longTitle(j.t), route: r.from + " → " + r.to, value: j.speed + " km/h", cat: j.cat };
      }));

    topTable(document.getElementById("top-late"),
      joined.filter((j) => j.delay > 0).sort((a, b) => b.delay - a.delay).slice(0, 5).map((j) => {
        const r = API.route(j.t);
        return { name: API.longTitle(j.t), route: r.from + " → " + r.to, value: "+" + j.delay + " min", cat: j.cat };
      }));
  }

  refresh();
  setInterval(refresh, REFRESH_MS);
})();
