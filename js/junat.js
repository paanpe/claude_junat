/* ==========================================================================
   Junakartta – kulussa olevat junat -sivu
   ========================================================================== */

(() => {
  const REFRESH_MS = 30000;

  const listEl = document.getElementById("train-list");
  const summaryEl = document.getElementById("summary-chips");
  const searchEl = document.getElementById("filter-text");
  const sortEl = document.getElementById("sort-select");
  const errorEl = document.getElementById("error-banner");
  const updatedEl = document.getElementById("updated-note");

  let trains = [];
  let speeds = new Map(); // key -> km/h
  let category = "kaikki";

  document.querySelectorAll(".chip[data-cat]").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip[data-cat]").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      category = chip.dataset.cat;
      render();
    });
  });
  searchEl.addEventListener("input", render);
  sortEl.addEventListener("change", render);

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function render() {
    const q = searchEl.value.trim().toLowerCase();
    let rows = trains.filter((t) => {
      if (category !== "kaikki" && API.categoryOf(t) !== category) return false;
      if (!q) return true;
      const r = API.route(t);
      const hay = (API.longTitle(t) + " " + t.trainNumber + " " + r.from + " " + r.to).toLowerCase();
      return hay.includes(q);
    });

    const sort = sortEl.value;
    rows.sort((a, b) => {
      if (sort === "nopeus") return (speedOf(b) || 0) - (speedOf(a) || 0);
      if (sort === "myohassa") return API.delayOf(b) - API.delayOf(a);
      return a.trainNumber - b.trainNumber;
    });

    const total = trains.length;
    const late = trains.filter((t) => API.delayOf(t) > 5).length;
    const cancelled = trains.filter((t) => t.cancelled).length;
    summaryEl.innerHTML =
      '<span class="badge badge-neutral">Kulussa: <b>&nbsp;' + total + "</b></span>" +
      '<span class="badge badge-ontime">Ajallaan (&le;5 min): ' + (total - late) + "</span>" +
      '<span class="badge badge-late">Myöhässä yli 5 min: ' + late + "</span>" +
      (cancelled ? '<span class="badge badge-cancelled">Peruttuja: ' + cancelled + "</span>" : "");

    const head =
      '<div class="train-row head"><span>Juna</span><span>Reitti</span>' +
      "<span>Nopeus</span><span>Tilanne</span><span>Seuraava pysähdys</span><span>Operaattori</span></div>";

    if (!rows.length) {
      listEl.innerHTML = head + '<div class="list-empty">Ei junia valituilla suodattimilla.</div>';
      return;
    }

    listEl.innerHTML = head + rows.map((t) => {
      const r = API.route(t);
      const badge = API.delayBadge(t);
      const next = API.nextStop(t);
      const spd = speedOf(t);
      const cat = API.categoryOf(t);
      return (
        '<div class="train-row" data-juna="' + t.trainNumber + '">' +
        '<span class="tr-name"><span class="cat-dot ' + cat + '"></span>' + esc(API.longTitle(t)) +
        '<span class="sub">' + API.CATEGORY_LABELS[cat] + " &middot; nro " + t.trainNumber + "</span></span>" +
        '<span class="tr-route">' + esc(r.from) + '<span class="arrow">&rarr;</span>' + esc(r.to) + "</span>" +
        '<span class="tr-speed">' + (spd != null ? spd + ' <span class="u">km/h</span>' : "&ndash;") + "</span>" +
        '<span><span class="badge ' + badge.cls + '">' + badge.text + "</span></span>" +
        '<span class="tr-next">' + (next ? "<b>" + esc(next.name) + "</b> klo " + API.fmtTime(next.time) : "&ndash;") + "</span>" +
        '<span class="tr-op">' + esc(t.operator ? t.operator.shortCode || "" : "") + "</span>" +
        "</div>"
      );
    }).join("");

    listEl.querySelectorAll(".train-row[data-juna]").forEach((el) => {
      el.addEventListener("click", () => {
        location.href = "index.html?juna=" + el.dataset.juna + (API.MOCK ? "&mock" : "");
      });
    });
  }

  function speedOf(t) {
    const s = speeds.get(API.trainKey(t));
    return s == null ? null : Math.round(s);
  }

  async function refresh() {
    try {
      const [running, positions] = await Promise.all([
        API.getRunningTrains(),
        API.getTrainLocations().catch(() => []),
      ]);
      trains = running;
      speeds = new Map(positions.map((p) => [p.departureDate + ":" + p.trainNumber, p.speed]));
      errorEl.classList.remove("on");
      updatedEl.textContent = "Päivitetty " + API.fmtClock() + " · tiedot päivittyvät 30 sekunnin välein.";
      render();
    } catch (err) {
      console.error(err);
      errorEl.classList.add("on");
    }
  }

  refresh();
  setInterval(refresh, REFRESH_MS);
})();
