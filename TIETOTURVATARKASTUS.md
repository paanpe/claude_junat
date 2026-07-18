# Tietoturvatarkastus – Junakartta

**Tarkastuksen tekijä:** GitHub Copilot (Claude 3.5 Sonnet)  
**Tarkastuksen päivämäärä:** 18.07.2026  
**Käytetty malli:** Claude 3.5 Sonnet  

---

## 1. Tarkastuksen laajuus

Tarkastukseen sisältyi:

- **Lähdekoodin analysointi**: Kaikki JavaScript-, HTML- ja CSS-tiedostot
- **Arkkitehtuuri ja tietovirrat**: Kartta-, API-, ja käyttöliittymälogiikka
- **Ulkoisen datan käyttö**: Digitraffic-rajapinnan integraatio
- **Käyttäjän tiedot ja paikannusominaisuudet**: Geolocation API:n käyttö
- **Tallennusmekanismit**: LocalStorage ja SessionStorage
- **Ohjelmistokomponentit**: Riippuvuudet, kirjastot ja vendor-koodit

---

## 2. Merkittävät havainnot

### 2.1 Positiiviset tietoturvapiirteet

✅ **Yksinkertainen arkkitehtuuri**
- Sovellus on täysin staattinen (vanilla JavaScript, ei kehyksiä)
- Ei taustajärjestelmää tai tietokantaa omassa hallinnassa
- Minimaalinen hyökkäjien pinta-ala

✅ **Content Security Policy -yhteensopivuus**
- Inline-skriptit eivät ole pakollisia
- Sovellus toimii CSP:n kanssa, mikäli GitHub Pages aktivoi sen

✅ **Tietoturvalliset ulkoiset rajapinnat**
- Digitraffic-rajapinta käyttää HTTPS:ää
- Tiedot ovat julkisia (CC BY 4.0 -lisensoidut)
- CORS-poikkeama on oikeutettu (API sallii sen)

✅ **Paikannusominaisuuden hallinta**
- Käytetään W3C Geolocation API:a (selain hallinnoi lupaa)
- Käyttäjä voi kieltää paikannuksen milloin tahansa
- Paikannus on valinnainen ominaisuus

### 2.2 Tietoturvariskit ja heikkoudet

⚠️ **XSS-haavoittuvuus**: Käyttäjän syöte renderöidään HTML-sisällöksi

**Sijainti**: `js/map.js`, rivit 356–361

```javascript
searchResults.innerHTML = hits.length
  ? hits.map((it) =>
      '<div class="search-item" data-key="' + it.key + '">' +
      '<span class="cat-dot ' + it.cat + '"></span>' +
      '<div><div class="t">' + it.title + '</div><div class="r">' + 
      (it.routeText || "&nbsp;") + "</div></div>" +
      '<span class="spd">' + it.speed + " km/h</span></div>"
    ).join("")
```

**Riski**: Junien nimet ja reittitiedot tulevat Digitraffic-rajapinnasta, jota kontrolloivat kolmannet osapuolet. Jos JSON-vastaus manipuloidaan MITM-hyökkäyksessä tai välipalvelimella, HTML-injektio on mahdollista.

**Vakavuus**: KORKEA (Reflected XSS)

**Korjaus**: Käytä `textContent` tai `createElement()` sen sijasta:
```javascript
const div = document.createElement('div');
div.className = 'search-item';
div.dataset.key = it.key;
// ... aseta sisältö turvallisesti
```

---

⚠️ **XSS-haavoittuvuus**: Junan tietoikkuna (popup)

**Sijainti**: `js/map.js`, rivit 245–270 (`popupHtml`-funktio)

```javascript
html += '<div class="tp-title">' + API.longTitle(d) + "</div>";
html += '<div class="tp-route">' + r.from + " → " + r.to + "</div>";
```

**Riski**: Junien nimet ja asemien nimet yhdistetään suoraan HTML:ään ilman sanitointia.

**Vakavuus**: KORKEA (Reflected XSS)

**Korjaus**: Käytä `textContent`:
```javascript
const titleEl = document.createElement('div');
titleEl.className = 'tp-title';
titleEl.textContent = API.longTitle(d);
html += titleEl.outerHTML;
```

---

⚠️ **DOM-sekoitus popu-ikkunoissa**

**Sijainti**: `js/map.js`, rivit 277–286

```javascript
setTimeout(() => {
  const btn = document.querySelector(".tp-follow[data-key]");
  if (btn) {
    btn.addEventListener("click", () => {
      // ...
    });
  }
}, 0);
```

**Riski**: Event listener asetetaan DOM-elementtiin, jonka sisältö on luotu HTML-stringinä. Vaikka Leaflet sanitoi jonkin verran, tämä on herkkyysalue.

**Vakavuus**: KESKIKORKEA

---

⚠️ **LocalStorage tietoturvariskien kanssa**

**Sijainti**: `js/map.js`, rivit 35–37, 47

```javascript
let savedBase;
try { localStorage.getItem(BASEMAP_STORE); } catch (e) { /* yksityistila */ }
// ... später:
localStorage.setItem(BASEMAP_STORE, e.name);
```

**Riski**: 
- LocalStorage ei ole salattu ja se on altis XSS-hyökkäyksille.
- Jos XSS saavutetaan, hyökkääjä voi lukea/kirjoittaa LocalStorageen.
- Tässä tapauksessa vain kartan pohjan valinta tallennetaan, mutta periaatetasolla ei-kriittisten tietojen tallennus on OK.

**Vakavuus**: MATALA (tietojen tyyppi ei ole herkkä)

---

⚠️ **CORS-luottamus**: Digitraffic-rajapinta on merkitty CORS-yhteensopivaksi

**Sijainti**: `js/api.js`, rivit 15–28

```javascript
async function fetchJSON(url, options = {}, withUserHeader = true) {
  const headers = Object.assign({}, options.headers);
  if (withUserHeader) headers["Digitraffic-User"] = APP_ID;
  try {
    const res = await fetch(url, ...);
```

**Riski**: 
- Sovellus luottaa siihen, että `rata.digitraffic.fi` palvelee oikeaa dataa.
- Jos DNS esiotetaan tai palvelin kompromitoidaan, kaikki junadata on altis.
- Selain ei voi varmistaa rajapinnan kryptograafista identiteettiä TLS-pinnausta ilman.

**Vakavuus**: MATALA (Digitraffic on julkinen ja luotettu datasähköpostilähde)

---

⚠️ **Geolocation-tiedot käsitellään muistissa ilman salaus**

**Sijainti**: `js/map.js`, rivit 418–432

```javascript
geoWatch = navigator.geolocation.watchPosition(
  (p) => {
    const ll = [p.coords.latitude, p.coords.longitude];
    // ... muistetaan karttalle
```

**Riski**: 
- Käyttäjän sijainti on näkyvissä JavaScript-muistissa.
- Jos sivustolla on XSS-haavoittuvuus, hyökkääjä voi lukea koordinaatit.

**Vakavuus**: KESKIKORKEA (herkkää henkilökohtaista dataa)

**Korjaus**: Ei tarvitse muistaa paikannusta pitkäaikaisesti; tyhjennä se kun paikannus lopetetaan (jo tehty rivissä 408).

---

⚠️ **JSON-injektio mock-tilassa**

**Sijainti**: `js/api.js`, rivit 188–249

```javascript
const MOCK_TRAINS = [
  { n: 27, type: "IC", cat: "Long-distance", ... },
  // ...
];

function mockLocations() {
  const now = Date.now();
  return MOCK_TRAINS.map((t) => ({
    trainNumber: t.n,
    departureDate: mockDate,
    // ...
```

**Riski**: Mock-tila on tarkoitettu kehitykseen, mutta jos se jää tuotantoon ja `?mock` on dokumentoitu, testaajat/hyökkääjät voivat ohittaa oikeat tiedot.

**Vakavuus**: MATALA (tämä on käyttäjän hallinnassa, tarkoitus)

---

### 2.3 Infrastruktuuririskit

**GitHub Pages -julkaisu**

**Sijainti**: `.github/workflows/pages.yml`

- GitHub Pages isännöi sisältöä osoitteessa `https://paanpe.github.io/claude_junat`
- HTTPS on pakollinen (GitHub Pages ei salli HTTP)
- Repositorio on julkinen → sisällön muutokset ovat näkyvissä versiohallinnassa

**Riski**: Jos repository-omistajan tunnus compromitoidaan, koodia voidaan muuttaa.  
**Vakavuus**: Korkea, mutta riskien hallinta on GitHub-nimisen organisaation vastuulla.

---

## 3. Yhteenveto riskiprofiilista

| Riski | Vakavuus | Tila |
|-------|----------|------|
| XSS junien nimet (search) | 🔴 Korkea | Avoin |
| XSS popup-ikkunat | 🔴 Korkea | Avoin |
| DOM-sekoitus | 🟡 Keskikorkea | Avoin |
| Geolocation-datan XSS-altistus | 🟡 Keskikorkea | Avoin |
| LocalStorage-XSS | 🟢 Matala | Avoin (ei-kriittinen) |
| CORS-rajapinnan luottamus | 🟢 Matala | Hallittu |
| Mock-tila paljastaa väärää dataa | 🟢 Matala | Hallittu |

---

## 4. Suositukset

### Välitöntä toimintaa vaativat

1. **XSS-korjaukset**
   - Korvaa kaikki `innerHTML`-asettelut `.textContent` tai DOM-elementeillä
   - Käytä template-kirjastoa tai `DOMPurify`:ta herkkien tietojen kohdalla

2. **Sisällön turvapolitiikka (CSP)**
   - Lisää GitHub Pages -asetuksiin CSP-otsikko
   - Estä inline-skriptit ja inline-tyylit

### Lyhytaikaista

3. **Koodikatselmus**
   - Kehitä säännöt XSS-ehkäisylle (`textContent`, element APIs)

4. **HTTPS-pinaus**
   - Harkitse TLS-sertifikaatin pinaamista Digitraffic-rajapintaan tuotannossa

### Pitkäaikaista

5. **Riippuvuuksien jäljitys**
   - Leaflet-vendorointi on hyvä, mutta päivitä se säännöllisesti tietoturvakorjauksista

6. **Käyttäjän tiedot**
   - Älä loggaa paikannustietoja palvelimelle ilman ilmoitusta
   - Päivitä tietosuojaseloste tarvittaessa

---

## 5. Testatut versiot

- **Leaflet**: 1.9.4 (vendoroitu)
- **Digitraffic API**: v1, v2 (GraphQL)
- **Selaimen ominaisuudet**: Geolocation API, localStorage, fetch API
- **Lähdekoodin päivämäärä**: Tarkastettu päähaaran tilasta 18.07.2026

---

## 6. Allekirjoitus

Tarkastuksen suoritti Claude 3.5 Sonnet, joka on generatiivinen AI-malli. Tämä raportti perustuu staattisen koodianalyysin tuloksiin eikä testata koko sovellusympäristöä dynaamisesti.

**Huom.** Korjaustoimenpiteitä suositellaan ennen tuotantoon ottamista, erityisesti XSS-haavoittuvuuksien osalta.
