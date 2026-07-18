# Junakartta 🚆

Interaktiivinen selainsovellus, joka näyttää Suomen junaliikenteen livenä
[Fintrafficin Digitraffic-rajapinnan](https://www.digitraffic.fi/rautatieliikenne/) tiedoilla.

## Ominaisuudet

- **Kartta** (`index.html`) – junat liikkuvat kartalla reaaliajassa (sijainnit
  päivittyvät 5 sekunnin välein ja liike interpoloidaan sulavaksi).
  Rautatieverkko näytetään OpenRailwayMap-tasona, jonka voi kytkeä päälle/pois.
  Junahaku (numero, linjatunnus tai asema), junan seuranta ja paikannusnappi.
  Junan klikkaus avaa tiedot: reitti, nopeus, myöhästyminen ja seuraava pysähdys.
- **Kulussa olevat junat** (`junat.html`) – lista kaikista liikkeellä olevista
  junista suodattimineen ja lajitteluineen. Klikkaus vie junan kohdalle kartalle.
- **Tilastot** (`tilastot.html`) – livenä lasketut tunnusluvut: junamäärä,
  keskinopeus, täsmällisyys, myöhästymisminuutit sekä jakaumat junatyypeistä,
  nopeuksista, myöhästymisistä ja operaattoreista, ja top-listat.

## Käynnistys

Sovellus on täysin staattinen – riittää mikä tahansa HTTP-palvelin:

```bash
python3 -m http.server 8000
# avaa http://localhost:8000
```

Suora `file://`-avaus ei toimi, koska selain estää rajapintakutsut.

### Kehitystila ilman verkkoyhteyttä

Lisää osoitteeseen `?mock`, esim. `http://localhost:8000/index.html?mock`,
jolloin sovellus käyttää sisäänrakennettua esimerkkidataa.

## Tekniikka ja tietolähteet

- Vanilla JS + [Leaflet 1.9](https://leafletjs.com/) (CDN), ei build-vaihetta.
- Junien sijainnit: `GET /api/v1/train-locations/latest` (5 s välein)
- Kulussa olevien junien aikataulut: GraphQL `currentlyRunningTrains`
  (`/api/v2/graphql/graphql`, 30–60 s välein)
- Asemametadata: `GET /api/v1/metadata/stations`
- Taustakartta: © OpenStreetMap © CARTO · Rataverkko: © OpenRailwayMap (CC-BY-SA)
- Liikennetiedot: Fintraffic / digitraffic.fi, lisenssi CC BY 4.0
