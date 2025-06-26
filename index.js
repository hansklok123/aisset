
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
