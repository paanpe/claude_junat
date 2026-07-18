/* ==========================================================================
   Junakartta – junatyypit-sivu
   Kulussa olevat junat ryhmiteltynä junatyypin (IC, S, PYO, HDM, T, …) mukaan.
   ========================================================================== */

(() => {
  const REFRESH_MS = 60000;
  const MAX_TRAIN_CHIPS = 8;

  const gridEl = document.getElementById("type-grid");
  const summaryEl = document.getElementById("summary-chips");
  const errorEl = document.getElementById("error-banner");
  const updatedEl = document.getElementById("updated-note");

  // Yleisimpien junatyyppien kuvaukset. Tuntemattomille tyypeille käytetään
  // Digitrafficin kategoriasta johdettua yleisnimeä.
  const TYPE_INFO = {
    IC: "InterCity – kaksikerroksinen kaukojuna",
    S: "Pendolino – nopea kallistuvakorinen kaukojuna",
    P: "Pikajuna – mm. VR:n yöjunat pohjoiseen",
    PYO: "Yöpikajuna – yöjuna makuuvaunuineen",
    HL: "HSL-lähijuna – Helsingin seudun lähiliikenne",
    HLV: "Lähiliikenteen lisä- tai vakiovuoro",
    HDM: "Kiskobussi – dieselmoottorijuna maakuntaradoilla",
    HSM: "Sähkömoottorijuna – taajamajunaliikenne",
    PAI: "Paikallisjuna",
    T: "Tavarajuna – rahtiliikenne",
    TYO: "Työjuna – radanpidon ja ratatöiden liikenne",
    VET: "Veturijuna – pelkkä veturi ilman vaunuja",
    VLI: "Vaihtotyö linjalla",
    MUS: "Museojuna",
    LIV: "Radantarkastusjuna",
    SAA: "Saattojuna",
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function typeDescription(code, cat) {
    return TYPE_INFO[code] || API.CATEGORY_LABELS[cat] || "Muu liikenne";
  }

  function delayClass(d) {
    if (d > 15) return "d-verylate";
    if (d > 5) return "d-late";
    return "d-ok";
  }

  function delayText(d) {
    if (d > 0) return "+" + d;
    if (d < 0) return String(d);
    return "±0";
  }

  async function refresh() {
    try {
      const [trains, positions] = await Promise.all([
        API.getRunningTrains(),
        API.getTrainLocations().catch(() => []),
      ]);
      errorEl.classList.remove("on");
      render(trains, positions);
      updatedEl.textContent = "Päivitetty " + API.fmtClock() +
        " · tiedot päivittyvät minuutin välein. Lähde: Fintraffic / digitraffic.fi (CC BY 4.0).";
    } catch (err) {
      console.error(err);
      errorEl.classList.add("on");
    }
  }

  function render(trains, positions) {
    const speedByKey = new Map(positions.map((p) => [p.departureDate + ":" + p.trainNumber, p.speed || 0]));

    // Ryhmittely junatyypin (esim. IC, S, T) mukaan.
    const groups = new Map();
    for (const t of trains) {
      const code = t.trainType && t.trainType.name ? t.trainType.name : "?";
      if (!groups.has(code)) {
        groups.set(code, { code, cat: API.categoryOf(t), trains: [] });
      }
      const speed = speedByKey.get(API.trainKey(t));
      groups.get(code).trains.push({
        t,
        delay: API.delayOf(t),
        speed: speed != null ? Math.round(speed) : null,
      });
    }

    const sorted = [...groups.values()].sort((a, b) => b.trains.length - a.trains.length);

    summaryEl.innerHTML =
      '<span class="badge badge-neutral">Junatyyppejä liikenteessä: <b>&nbsp;' + sorted.length + "</b></span>" +
      '<span class="badge badge-neutral">Junia yhteensä: <b>&nbsp;' + trains.length + "</b></span>";

    gridEl.innerHTML = sorted.map((g) => {
      const n = g.trains.length;
      const speeds = g.trains.filter((x) => x.speed != null && x.speed > 0);
      const avgSpeed = speeds.length
        ? Math.round(speeds.reduce((a, x) => a + x.speed, 0) / speeds.length) : null;
      const punctual = g.trains.filter((x) => x.delay <= 5).length;
      const punctuality = Math.round((punctual / n) * 100);
      const late = g.trains.filter((x) => x.delay > 0);
      const avgLate = late.length
        ? (late.reduce((a, x) => a + x.delay, 0) / late.length).toFixed(1) : "0";

      const shown = g.trains.slice()
        .sort((a, b) => a.t.trainNumber - b.t.trainNumber)
        .slice(0, MAX_TRAIN_CHIPS);
      const rest = n - shown.length;

      const chips = shown.map((x) => {
        const r = API.route(x.t);
        return '<span class="type-train" data-juna="' + x.t.trainNumber + '" title="' +
          esc(r.from + " → " + r.to) + '"><b>' + esc(API.shortTitle(x.t)) + "</b>" +
          '<span class="' + delayClass(x.delay) + '">' + delayText(x.delay) + "</span></span>";
      }).join("") + (rest > 0 ? '<span class="type-more">ja ' + rest + " muuta…</span>" : "");

      return (
        '<div class="card type-card">' +
        '<div class="type-head">' +
        '<span class="type-code ' + g.cat + '">' + esc(g.code) + "</span>" +
        "<div><h3>" + esc(typeDescription(g.code, g.cat).split(" – ")[0]) + "</h3>" +
        '<span class="type-cat">' + esc(typeDescriptionRest(g.code, g.cat)) + "</span></div></div>" +
        '<div class="type-stats">' +
        '<div class="type-stat"><div class="v">' + n + "</div><div class=\"l\">kulussa</div></div>" +
        '<div class="type-stat"><div class="v">' + (avgSpeed != null ? avgSpeed + '<span class="u">km/h</span>' : "–") +
        "</div><div class=\"l\">keskinopeus</div></div>" +
        '<div class="type-stat"><div class="v">' + punctuality + '<span class="u">%</span>' +
        "</div><div class=\"l\">ajallaan</div></div>" +
        "</div>" +
        (late.length ? '<p class="ch-sub" style="margin:0 0 12px">' + late.length +
          " junaa myöhässä, keskimäärin " + avgLate + " min</p>" : "") +
        '<div class="type-trains">' + chips + "</div>" +
        "</div>"
      );
    }).join("");

    // Kortin alaotsikko: kuvauksen selitysosa tai pelkkä kategoria.
    function typeDescriptionRest(code, cat) {
      const desc = typeDescription(code, cat);
      const idx = desc.indexOf(" – ");
      if (idx < 0) return API.CATEGORY_LABELS[cat] || "Muu";
      const tail = desc.slice(idx + 3);
      return tail.charAt(0).toUpperCase() + tail.slice(1);
    }

    gridEl.querySelectorAll(".type-train[data-juna]").forEach((el) => {
      el.addEventListener("click", () => {
        location.href = "index.html?juna=" + el.dataset.juna + (API.MOCK ? "&mock" : "");
      });
    });
  }

  refresh();
  setInterval(refresh, REFRESH_MS);
})();
