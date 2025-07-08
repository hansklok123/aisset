
require('dotenv').config();
const basicAuth = require('express-basic-auth');
const express = require("express");
const path = require("path");
const fs = require("fs");
const { startStream, getNearbyShips } = require("./aisstream");
const { google } = require('googleapis');
const { parse } = require('csv-parse/sync');
const fetch = require('node-fetch');
const cheerio = require('cheerio');


startStream();


const app = express();

const authMiddleware = basicAuth({
  users: { [process.env.AUTH_USER]: process.env.AUTH_PASS },
  challenge: true,
  realm: 'Beveiligd gebied'
});

app.use((req, res, next) => {
  // Voeg hier meer paden toe als je meer wilt beveiligen
  if (
    req.path === "/admin.html" ||
    req.path === "/data/submissions.json"
  ) {
    return authMiddleware(req, res, next);
  }
  next();
});


app.use(express.json());
app.use(express.static("public"));


const { DateTime } = require('luxon');

// Zorg dat de data-directory bestaat
const dataDir = path.join(__dirname, "public", "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Sheets-authenticatie
const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const SPREADSHEET_ID = '1RX5vPm3AzYjlpdXgsbuVkupb4UbJSct2wgpVArhMaRQ';
const SHEET_NAME = 'submissions';

async function getShipInfoByMMSI(mmsi) {
  // Eerste stap: haal de hoofdpagina op en zoek IMO
  const searchUrl = `https://www.vesselfinder.com/?mmsi=${mmsi}`;
  const res = await fetch(searchUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
  const html = await res.text();

  // IMO uit JavaScript (var IMO = 9376725;)
  const imoMatch = html.match(/var\s+IMO\s*=\s*(\d+);/);
  let imo = imoMatch ? imoMatch[1] : null;

  if (!imo) {
    return {
      shipName: null,
      shipType: null,
      length: null,
      draught: null,
      imo: null,
      mmsi,
      source: searchUrl,
      error: "IMO niet gevonden"
    };
  }

  // Tweede stap: haal de details op via de IMO detailpagina
  const detailsUrl = `https://www.vesselfinder.com/vessels/details/${imo}`;
  const detailsRes = await fetch(detailsUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
  const detailsHtml = await detailsRes.text();
  const $ = cheerio.load(detailsHtml);

  // Naam
  const shipName = $('.vessl-title span').first().text().trim() || $('.vessl-title').first().text().trim();

  // Type, lengte, draught
  let shipType = null, length = null, draught = null;
  $('tr').each((i, el) => {
    const key = $(el).find('td.tpc1').text().trim();
    const val = $(el).find('td.tpc2').text().trim();
    if (/ship type/i.test(key)) shipType = val;
    if (/length overall/i.test(key)) length = val;
    if (/draught/i.test(key)) draught = val;
  });

  return {
    shipName: shipName || null,
    shipType: shipType || null,
    length: length || null,
    draught: draught || null,
    imo,
    mmsi,
    source: detailsUrl
  };
}

// ----------- HAVEN LOCATIES (VOOR TOPLOCATIE) -----------
const havenAreas = [
  { naam: "Europoort",         lat: 51.95, lon: 3.97,   radiusKm: 3 },
  { naam: "Maasvlakte",        lat: 51.95, lon: 4.02,   radiusKm: 3 },
  { naam: "Waalhaven",         lat: 51.88, lon: 4.40,   radiusKm: 1.5 },
  { naam: "Botlek",            lat: 51.89, lon: 4.26,   radiusKm: 2 },
  { naam: "Eemhaven",          lat: 51.89, lon: 4.43,   radiusKm: 1.2 },
  { naam: "Pernis",            lat: 51.88, lon: 4.36,   radiusKm: 1.2 },
  { naam: "Hoek van Holland",  lat: 51.98, lon: 4.13,   radiusKm: 2 },
  { naam: "Dordrecht",         lat: 51.81, lon: 4.66,   radiusKm: 2 },
  { naam: "Kop van Zuid",      lat: 51.90, lon: 4.49,   radiusKm: 1 },
  { naam: "Centrum Rotterdam", lat: 51.92, lon: 4.48,   radiusKm: 1.2 },
  { naam: "Nieuwe Maas",       lat: 51.92, lon: 4.38,   radiusKm: 2 },
  { naam: "Moerdijk",          lat: 51.6987, lon: 4.6157, radiusKm: 2 }
];

// Haversine distance (km)
function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = x => (x * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Vind dichtstbijzijnde haven(gebied)
function getClosestHaven(lat, lon) {
  let best = null, minDist = Infinity;
  for (const haven of havenAreas) {
    const d = distanceKm(lat, lon, haven.lat, haven.lon);
    if (d < haven.radiusKm && d < minDist) {
      minDist = d;
      best = haven.naam;
    }
  }
  // Geen specifieke haven gevonden? Geef "Onbekend" of de dichtstbijzijnde terug
  if (!best) {
    // Als je echt altijd wilt mappen:
    havenAreas.forEach(haven => {
      const d = distanceKm(lat, lon, haven.lat, haven.lon);
      if (d < minDist) {
        minDist = d;
        best = haven.naam;
      }
    });
  }
  return best || "Onbekend";
}


// ======= sheets authenticatie, pas range aan =======
async function getSubmissionsFromSheet() {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1:O`,  // <-- nu 12 kolommen i.p.v. 11 (A t/m L)
  });

  return res.data.values || [];
}

async function appendToGoogleSheet(record) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

const row = [
  record.Scheepsnaam ?? "",
  record.ScheepsnaamHandmatig ?? "",
  record.ETD ?? "",
  record.RedenGeenETD ?? "",
  record.Toelichting ?? "",
  record.Status ?? "",
  record.Type_naam ?? "",
  record.Lengte ?? "",
  record.Timestamp ?? "",
  record.Latitude ?? "",
  record.Longitude ?? "",
  record.MMSI ?? "",
  record.Type_actueel ?? "",
  record.Lengte_actueel ?? "",
  record.Draught_actueel ?? "",
  record.Naam ?? ""
];


  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1:O`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [row] },
  });
}

function isValidISODate(str) {
  return DateTime.fromISO(str).isValid;
}

function formatDateTime(dt) {
  // dt kan string of DateTime zijn
  return DateTime.fromISO(dt).setZone("Europe/Amsterdam").toFormat("dd-MM-yy HH:mm");
}

function formatETDWaarde(waarde) {
  if (!waarde) return "";

  const tijdvakMatch = waarde.match(/\(E:(.*?)\)/);
  const tijdvak = tijdvakMatch ? tijdvakMatch[1] : null;

  const datumMatch = waarde.match(/(\d{4}-\d{2}-\d{2})/);
  const datumISO = datumMatch ? datumMatch[1] : null;

  if (tijdvak && datumISO) {
    const dag = DateTime.fromISO(datumISO).toFormat("dd-MM-yy");
    return `${dag} E${tijdvak}`;
  }

  // Geen tijdvak: gewoon exacte ETD zonder tijdzone wijziging
  if (isValidISODate(waarde)) {
    return DateTime.fromISO(waarde).toFormat("dd-MM-yy HH:mm");
  }

  return waarde; // fallback
}


app.post("/api/verstuur", async (req, res) => {
  const csv = req.body.csv;

  if (!csv) {
    return res.status(400).send("CSV ontbreekt");
  }

  const parsed = parse(csv, {
    skip_empty_lines: true,
    trim: true
  });

  if (parsed.length < 2) {
    return res.status(400).send("Ongeldige CSV");
  }

  const delen = parsed[1];

  const record = {
    Scheepsnaam: delen[0]?.replaceAll('"', ""),
    ScheepsnaamHandmatig: delen[1]?.replaceAll('"', ""),
    ETD: formatETDWaarde(delen[2]?.replaceAll('"', "")),
    RedenGeenETD: delen[3]?.replaceAll('"', ""),
    Toelichting: delen[4]?.replaceAll('"', ""),
    Status: delen[5]?.replaceAll('"', ""),
    Type_naam: delen[6]?.replaceAll('"', ""),
    Lengte: delen[7]?.replaceAll('"', ""),
    Timestamp: DateTime.now().setZone("Europe/Amsterdam").toFormat("dd-MM-yy HH:mm"),
    Latitude: delen[9]?.replaceAll('"', ""),
    Longitude: delen[10]?.replaceAll('"', ""),
    Naam: delen[11]?.replaceAll('"', "")
  };

// Laad schepen.json direct (altijd actueel)
const schepenPath = path.join(__dirname, "public", "data", "schepen.json");
let schepenObj = {};
try {
  schepenObj = JSON.parse(fs.readFileSync(schepenPath, "utf8"));
} catch (err) {
  console.error("Kon schepen.json niet lezen:", err);
}

// Maak alle namen lowercase en getrimd voor zoeken
function normalizeNaam(naam) {
  return (naam || "").toLowerCase().trim();
}

const ingevoerdeNaam = normalizeNaam(record.Scheepsnaam) || normalizeNaam(record.ScheepsnaamHandmatig);

// Zoek een match op naam
let matchMmsi = null;
let match = null;
for (const [mmsi, s] of Object.entries(schepenObj)) {
  if (normalizeNaam(s.naam) === ingevoerdeNaam && ingevoerdeNaam !== "") {
    match = s;
    matchMmsi = mmsi;
    break;
  }
}


// Extra: als geen naam, probeer op handmatig, en als nog niks: laat alles leeg
if (!match && ingevoerdeNaam) {
  // soms zit handmatige naam nergens in lijst, dus niks invullen
}

// ... na het zoeken van de match:
if (match && match.track?.length > 0) {
  const laatste = match.track[match.track.length - 1];
  record.Latitude = laatste.lat ? parseFloat(laatste.lat).toFixed(5) : "";
  record.Longitude = laatste.lon ? parseFloat(laatste.lon).toFixed(5) : "";
  record.Type_naam = match.type_naam || "";
  record.Lengte = match.lengte || "";
  record.MMSI = matchMmsi || ""; // <--- gebruik nu de gevonden MMSI
} else {
  record.Type_naam = record.Type_naam || "Onbekend";
  record.Lengte = record.Lengte || "";
  record.MMSI = "";
}

if (record.MMSI) {
  try {
    const vesselFinderInfo = await getShipInfoByMMSI(record.MMSI);
    record.Type_actueel = vesselFinderInfo.shipType || "";
    record.Lengte_actueel = vesselFinderInfo.length ? (
      vesselFinderInfo.length.endsWith('m') 
        ? vesselFinderInfo.length 
        : `${vesselFinderInfo.length} m`
    ) : "";
    record.Draught_actueel = vesselFinderInfo.draught || "";
    record.IMO = vesselFinderInfo.imo || "";

    // Overschrijf bestaande velden als er een waarde is!
    if (vesselFinderInfo.shipType) {
      record.Type_naam = vesselFinderInfo.shipType;
    }
    if (vesselFinderInfo.length) {
      record.Lengte = vesselFinderInfo.length.endsWith('m')
        ? vesselFinderInfo.length
        : `${vesselFinderInfo.length} m`;
    }
  } catch (err) {
    console.warn("Kon actuele scheepsinfo niet ophalen:", err);
    record.Type_actueel = "";
    record.Lengte_actueel = "";
    record.Draught_actueel = "";
    record.IMO = "";
  }
} else {
  record.Type_actueel = "";
  record.Lengte_actueel = "";
  record.Draught_actueel = "";
  record.IMO = "";
}



// Overschrijven van velden voor Sheet-weergave:
if (record.Type_actueel) {
  record.Type_naam = record.Type_actueel;
}
if (record.Lengte_actueel) {
  record.Lengte = record.Lengte_actueel;
}




  try {
    await appendToGoogleSheet(record);

const rows = await getSubmissionsFromSheet();
const headers = rows[0]; // eerste rij zijn de kolomnamen
const records = rows.slice(1).map(rij => {
  const obj = {};
  headers.forEach((kolom, i) => {
    obj[kolom] = rij[i] || "";
  });
  return obj;
});

// ✅ Hier definieer je syncPath correct
const syncPath = path.join(__dirname, "public", "data", "submissions.json");
fs.writeFileSync(syncPath, JSON.stringify(records, null, 2));



    return res.json({ success: true, message: "Inzending opgeslagen in Google Sheets." });
  } catch (err) {
    console.error('Sheets error:', err);
    return res.status(500).json({ success: false, message: "Fout bij opslaan." });
  }
});

app.get("/data/submissions.json", authMiddleware, async (req, res) => {
  try {
    const data = await getSubmissionsFromSheet();
    res.json(data);
  } catch (err) {
    console.error("❌ Fout bij ophalen uit Google Sheets:", err);
    res.status(500).json({ error: "Kan gegevens niet ophalen." });
  }
});

app.get("/api/ping", (req, res) => {
  res.send("✅ API actief");
});

app.get("/api/schepen", (req, res) => {
  res.json(getNearbyShips());
});

(async () => {
  try {
    const rows = await getSubmissionsFromSheet();
    const headers = rows[0];
    const records = rows.slice(1).map(rij => {
      const obj = {};
      headers.forEach((kolom, i) => {
        obj[kolom] = rij[i] || "";
      });
      return obj;
    });
    const syncPath = path.join(__dirname, "public", "data", "submissions.json");
    fs.writeFileSync(syncPath, JSON.stringify(records, null, 2));
    console.log("✅ submissions.json gesynchroniseerd bij serverstart.");
  } catch (err) {
    console.error("❌ Fout bij initiële synchronisatie:", err);
  }
})();

const webpush = require("web-push");
const subscriptionsPath = path.join(__dirname, "subscriptions.json");
const SUBS_SHEET_ID = process.env.SPREADSHEET_ID_SUBSCRIPTIONS;
const SUBS_SHEET_NAME = 'subscriptions_data';

let subscriptions = [];

// Probeer bij start al te laden uit bestand
if (fs.existsSync(subscriptionsPath)) {
  try {
    subscriptions = JSON.parse(fs.readFileSync(subscriptionsPath, "utf8"));
    console.log(`✅ Subscriptions geladen: ${subscriptions.length}`);
  } catch (err) {
    console.error("❌ Fout bij lezen subscriptions.json:", err);
  }
}

async function logSubscriptionCountToSheet() {
  const count = subscriptions.length; // actuele teller
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const now = DateTime.now().setZone("Europe/Amsterdam").toFormat("dd-MM-yy HH:mm");

  const row = [now, count];

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SPREADSHEET_ID_SUBSCRIPTIONS,
    range: 'subscriptions!A1:B',
    valueInputOption: 'USER_ENTERED',
    resource: { values: [row] },
  });

  console.log(`✅ Actuele subscriptions (${count}) gelogd in Google Sheets`);
}


webpush.setVapidDetails(
  "mailto:shipsetd@gmail.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

app.post("/api/save-subscription", (req, res) => {
  const sub = req.body.subscription;
  subscriptions.push(sub);

  // Opslaan in bestand
  fs.writeFileSync(subscriptionsPath, JSON.stringify(subscriptions, null, 2));

  res.status(201).json({ message: "Subscription opgeslagen" });
});


async function uploadSubscriptionsToSheet() {
  try {
    if (!fs.existsSync(subscriptionsPath)) {
      console.log("⚠️ subscriptions.json niet gevonden, overslaan upload.");
      return;
    }

    // Haal lokale subscriptions
    let fileSubs = [];
    fileSubs = JSON.parse(fs.readFileSync(subscriptionsPath, "utf8"));

    // Haal bestaande subscriptions uit het sheet
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SUBS_SHEET_ID,
      range: `${SUBS_SHEET_NAME}!A:C`,
    });
    const sheetRows = res.data.values || [];
    const sheetSubs = sheetRows.map(r => ({
      endpoint: r[0],
      keys: { p256dh: r[1], auth: r[2] }
    }));

    // Merge op endpoint
    const byEndpoint = {};
    for (const s of [...sheetSubs, ...fileSubs]) {
      byEndpoint[s.endpoint] = s;
    }
    const merged = Object.values(byEndpoint);

    // Wis eerst oude inhoud
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SUBS_SHEET_ID,
      range: `${SUBS_SHEET_NAME}!A:C`,
    });

    // Schrijf terug
    const values = merged.map(sub => [
      sub.endpoint,
      sub.keys?.p256dh || "",
      sub.keys?.auth || ""
    ]);
    await sheets.spreadsheets.values.append({
      spreadsheetId: SUBS_SHEET_ID,
      range: `${SUBS_SHEET_NAME}!A:C`,
      valueInputOption: 'USER_ENTERED',
      resource: { values }
    });

    console.log(`✅ ${merged.length} subscriptions (uniek) gesynchroniseerd.`);
  } catch (err) {
    console.error("❌ Fout bij uploaden naar Google Sheets:", err);
  }
}


async function restoreSubscriptionsFromSheet() {
  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SUBS_SHEET_ID,
      range: `${SUBS_SHEET_NAME}!A:C`,
    });

    const rows = res.data.values;
    if (!rows || rows.length === 0) {
      console.log("⚠️ Geen subscriptions gevonden in sheet, niets hersteld.");
      return;
    }

    const restored = rows.map(r => ({
      endpoint: r[0],
      keys: {
        p256dh: r[1],
        auth: r[2],
      }
    }));

    fs.writeFileSync(subscriptionsPath, JSON.stringify(restored, null, 2));
    subscriptions = restored;

    console.log(`✅ ${restored.length} subscriptions hersteld vanuit Google Sheets naar subscriptions.json`);
  } catch (err) {
    console.error("❌ Fout bij herstellen vanuit Google Sheets:", err);
  }
}



// Endpoint om push notificaties te versturen
app.post("/api/send-notification", async (req, res) => {
  const { title, body } = req.body;

  const payload = JSON.stringify({
    title,
    body,
    icon: "/logo.png"
  });

  const results = [];
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
      results.push({ success: true });
    } catch (error) {
      results.push({ success: false, error: error.toString() });
    }
  }
  res.json(results);
});

app.get("/api/subscription-count", authMiddleware, (req, res) => {
  res.json({ count: subscriptions.length });
});
app.get("/api/latest-subscription-count", authMiddleware, async (req, res) => {
  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const resSheet = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID_SUBSCRIPTIONS,
      range: 'subscriptions!A:B',
    });

    const rows = resSheet.data.values;
    if (!rows || rows.length < 2) {
      return res.json({ count: 0, date: null });
    }

    const laatsteRow = rows[rows.length - 1];
    const date = laatsteRow[0];
    const count = parseInt(laatsteRow[1], 10) || 0;

    res.json({ count, date });
  } catch (err) {
    console.error("❌ Fout bij ophalen subscription count:", err);
    res.status(500).json({ error: "Fout bij ophalen count" });
  }
});

(async () => {
  await restoreSubscriptionsFromSheet();
})();

app.get("/api/statistieken", async (req, res) => {
  // Laad submissions.json
  const submissionsPath = path.join(__dirname, "public", "data", "submissions.json");
  let data = [];
  try {
    data = JSON.parse(fs.readFileSync(submissionsPath, "utf8"));
  } catch (err) {
    return res.status(500).json({ error: "Kan data niet lezen." });
  }

  // Statistieken tellers
  let locaties = {};
  let typeTellers = { bulk: 0, container: 0, overig: 0 };
  let tijdvakTellers = {};
  let countKapitein = 0;
  let countTotal = 0;
  let countWeek = 0;

  const now = new Date();
  const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);

  data.forEach(item => {
    if (!item.Latitude || !item.Longitude) return;
    const haven = getClosestHaven(Number(item.Latitude), Number(item.Longitude));
    locaties[haven] = (locaties[haven] || 0) + 1;

    // Scheepstype grof
    let type = (item.Type_naam || '').toLowerCase();
    if (type.includes("bulk")) typeTellers.bulk++;
    else if (type.includes("container")) typeTellers.container++;
    else typeTellers.overig++;

    // Tijdvak
    if (item.ETD && item.ETD.includes('E')) {
      const match = item.ETD.match(/E([0-9]{2}:[0-9]{2}-[0-9]{2}:[0-9]{2})/);
      if (match) tijdvakTellers[match[1]] = (tijdvakTellers[match[1]] || 0) + 1;
    }

    // ETD door kapitein: geen reden ingevuld = wel ETD door kapitein
    if (item.RedenGeenETD === "" && item.ETD) countKapitein++;

    // Inzendingen deze week
    let ts = item.Timestamp || "";
    // Verwacht formaat "07-07-25 22:20"
    let datumStr = ts.split(" ")[0];
    if (datumStr) {
      let [dd, mm, yy] = datumStr.split("-");
      let dateObj = new Date(`20${yy}-${mm}-${dd}`);
      if (dateObj >= weekAgo && dateObj <= now) countWeek++;
    }

    countTotal++;
  });

  // Meest gemelde haven
  let topLocatie = "Onbekend";
  let max = 0;
  Object.entries(locaties).forEach(([naam, count]) => {
    if (count > max) {
      max = count;
      topLocatie = naam;
    }
  });

  // Meest gebruikte tijdvak
  let topTijdvak = "";
  let maxTijdvak = 0;
  Object.entries(tijdvakTellers).forEach(([tv, cnt]) => {
    if (cnt > maxTijdvak) {
      maxTijdvak = cnt;
      topTijdvak = tv;
    }
  });

  // Percentages
  function pct(n) { return countTotal > 0 ? Math.round(100 * n / countTotal) : 0; }

  res.json({
    topLocatie,
    pctBulk: pct(typeTellers.bulk),
    pctContainer: pct(typeTellers.container),
    pctKapitein: pct(countKapitein),
    countWeek,
    topTijdvak
  });
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("✅ Server draait op poort", PORT);
});

function restartAtMidnight() {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 0, 0); // 00:00:00 volgende dag

  const msUntilMidnight = nextMidnight - now;

  setTimeout(() => {
    console.log("⏰ Herstart om middernacht...");
    process.exit(0); // Render zal de app automatisch opnieuw starten
  }, msUntilMidnight);
}

restartAtMidnight();

setInterval(() => {
  logSubscriptionCountToSheet().catch(console.error);
}, 60 * 60 * 1000); // elke 60 minuten

