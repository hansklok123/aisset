
require('dotenv').config();
const basicAuth = require('express-basic-auth');
const express = require("express");
const path = require("path");
const fs = require("fs");
const { startStream, getNearbyShips } = require("./aisstream");
const { google } = require('googleapis');
const { parse } = require('csv-parse/sync');

startStream();

const app = express();
app.use(express.json());
app.use(express.static("public"));

const authMiddleware = basicAuth({
  users: { [process.env.AUTH_USER]: process.env.AUTH_PASS },
  challenge: true,
  realm: 'Beveiligd gebied'
});

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

async function getSubmissionsFromSheet() {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1:K`,
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
    record.Longitude ?? ""
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [row] },
  });
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
    ETD: delen[2]?.replaceAll('"', ""),
    RedenGeenETD: delen[3]?.replaceAll('"', ""),
    Toelichting: delen[4]?.replaceAll('"', ""),
    Status: delen[5]?.replaceAll('"', ""),
    Type_naam: delen[6]?.replaceAll('"', ""),
    Lengte: delen[7]?.replaceAll('"', ""),
    Timestamp: new Date().toISOString(),
    Latitude: delen[9]?.replaceAll('"', ""),
    Longitude: delen[10]?.replaceAll('"', "")
  };

  const schepen = getNearbyShips();
  const match = schepen.find(s => s.naam?.trim() === record.Scheepsnaam?.trim());
  if (match && match.track?.length > 0) {
    const laatste = match.track[match.track.length - 1];
    record.Latitude = laatste.lat ? parseFloat(laatste.lat).toFixed(5) : "";
    record.Longitude = laatste.lon ? parseFloat(laatste.lon).toFixed(5) : "";
    record.Type_naam = match.type_naam || "";
    record.Lengte = match.lengte || "";
  }

  try {
    await appendToGoogleSheet(record);

    const rows = await getSubmissionsFromSheet();
const headers = rows[0]; // eerste rij = kolomnamen
const records = rows.slice(1).map(rij => {
  const obj = {};
  headers.forEach((kolom, i) => {
    obj[kolom] = rij[i] || "";
  });
  return obj;
});
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("✅ Server draait op poort", PORT);
});
