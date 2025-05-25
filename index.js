require('dotenv').config();
const basicAuth = require('express-basic-auth');
const express = require("express");
const path = require("path");
const fs = require("fs");
const { startStream, getNearbyShips } = require("./aisstream");
const { google } = require('googleapis');

// Zorg dat de data-directory bestaat
const dataDir = path.join(__dirname, "public", "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

startStream();
const app = express();
const authMiddleware = basicAuth({
  users: { [process.env.AUTH_USER]: process.env.AUTH_PASS },
  challenge: true,
  realm: 'Beveiligd gebied'
});

app.use(express.json());
app.use(express.static("public"));

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
    range: `${SHEET_NAME}!A1:K`, // Nu 11 kolommen
  });

  const rows = res.data.values;
  if (!rows || rows.length < 2) {
    return [];
  }
  const headers = rows[0];
  const records = rows.slice(1).map(row => {
    let obj = {};
    headers.forEach((key, i) => obj[key] = row[i] || "");
    return obj;
  });
  return records;
}

// === DATA ENDPOINTS ===
app.get("/data/submissions.json", authMiddleware, async (req, res) => {
  try {
    const data = await getSubmissionsFromSheet();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Kan Google Sheets niet uitlezen." });
  }
});

// === NIEUWE VERSTUUR-ROUTE MET JSON ===
app.post("/api/verstuur", async (req, res) => {
  const record = req.body;

  // Basic check: verplichte velden controleren (pas eventueel aan)
  const verplichteVelden = ["Scheepsnaam", "ScheepsnaamHandmatig", "ETD", "RedenGeenETD", "Toelichting", "Status", "Timestamp", "Latitude", "Longitude"];
  for (const veld of verplichteVelden) {
    if (typeof record[veld] === "undefined") {
      return res.status(400).json({ error: `Veld ontbreekt: ${veld}` });
    }
  }

  // Zet de data netjes in array volgorde
  const values = [
    record.Scheepsnaam || "",
    record.ScheepsnaamHandmatig || "",
    record.ETD || "",
    record.RedenGeenETD || "",
    record.Toelichting || "",
    record.Status || "",
    record.Timestamp || "",
    record.Latitude || "",
    record.Longitude || ""
  ];

  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    // Data append aan Google Sheets
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      resource: { values: [values] }
    });

    res.json({ success: true, message: "Formulier opgeslagen!" });
  } catch (error) {
    console.error("Fout bij opslaan in Google Sheets:", error);
    res.status(500).json({ error: "Fout bij opslaan in Google Sheets." });
  }
});

// Admin/exports etc. (ongewijzigd laten)
app.use("/data/submissions.json", authMiddleware);
app.use("/data/schepen.json", authMiddleware);
app.use("/admin/export", authMiddleware);

// Start de server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server gestart op poort ${PORT}`);
});
