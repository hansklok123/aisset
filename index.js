require('dotenv').config();
const basicAuth = require('express-basic-auth');
const express = require("express");
const path = require("path");
const { startStream, getNearbyShips } = require("./aisstream");
const { google } = require('googleapis');

startStream();
const app = express();
const authMiddleware = basicAuth({
  users: { [process.env.AUTH_USER]: process.env.AUTH_PASS },
  challenge: true,
  realm: 'Beveiligd gebied'
});

// Sheets-authenticatie
const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const SPREADSHEET_ID = '1RX5vPm3AzYjlpdXgsbuVkupb4UbJSct2wgpVArhMaRQ';
const SHEET_NAME = 'submissions';

// Functie om alle submissions uit Google Sheets te halen
async function getSubmissionsFromSheet() {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1:I`, // Pas 'I' aan naar de laatste kolom die je gebruikt
  });

  // Eerste rij is je header, daarna de data
  const rows = res.data.values;
  if (!rows || rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    let obj = {};
    headers.forEach((key, i) => obj[key] = row[i] || "");
    return obj;
  });
}

// Functie om een submission naar Google Sheets te schrijven
async function appendToGoogleSheet(record) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const row = [
    record.Scheepsnaam,
    record.ScheepsnaamHandmatig,
    record.ETD,
    record.RedenGeenETD,
    record.Toelichting,
    record.Status,
    record.Timestamp,
    record.Latitude,
    record.Longitude
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1`, // Gebruik altijd !A1, niet !A:A
    valueInputOption: 'USER_ENTERED',
    resource: { values: [row] },
  });
}

app.use("/admin.html", authMiddleware);
app.use("/data/submissions.json", authMiddleware);
app.use("/data/schepen.json", authMiddleware);
app.use("/admin/export", authMiddleware);

app.use(express.json());
app.use(express.static("public"));

// === JOUW DYNAMISCHE ROUTE VOOR ADMIN.HTML /data/submissions.json ===
app.get("/data/submissions.json", authMiddleware, async (req, res) => {
  try {
    const data = await getSubmissionsFromSheet();
    res.json(data);
  } catch (err) {
    console.error("Sheets uitlezen mislukt:", err);
    res.status(500).json({ error: "Kan Google Sheets niet uitlezen." });
  }
});

// === VERSTUUR-ROUTE ===
app.post("/api/verstuur", async (req, res) => {
  const { csv, onderwerp } = req.body;
  if (!csv || !onderwerp) return res.status(400).send("Ongeldige gegevens");

  const regels = csv.split("\n");
  if (regels.length >= 2) {
    const [_, inhoud] = regels;
    const delen = inhoud.split(",");
    const record = {
      Scheepsnaam: delen[0]?.replaceAll('"', ""),
      ScheepsnaamHandmatig: delen[1]?.replaceAll('"', ""),
      ETD: delen[2]?.replaceAll('"', ""),
      RedenGeenETD: delen[3]?.replaceAll('"', ""),
      Toelichting: delen[4]?.replaceAll('"', ""),
      Status: delen[5]?.replaceAll('"', ""),
      Timestamp: delen[6]?.replaceAll('"', ""),
      Latitude: delen[7]?.replaceAll('"', ""),
      Longitude: delen[8]?.replaceAll('"', "")
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
      return res.json({ success: true, message: "Inzending opgeslagen in Google Sheets." });
    } catch (err) {
      console.error('Sheets error:', err);
      return res.status(500).json({ success: false, message: "Fout bij opslaan in Google Sheets." });
    }
  } else {
    return res.status(400).send("Ongeldige gegevens");
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
