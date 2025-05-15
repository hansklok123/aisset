require('dotenv').config();
const basicAuth = require('express-basic-auth');

const express = require("express");
const fs = require("fs");
const path = require("path");
const { startStream, getNearbyShips } = require("./aisstream");

startStream();
const app = express();
const authMiddleware = basicAuth({
  users: { [process.env.AUTH_USER]: process.env.AUTH_PASS },
  challenge: true,
  realm: 'Beveiligd gebied'
});


app.use("/text.html", authMiddleware);
app.use("/map.html", authMiddleware);
app.use("/admin.html", authMiddleware);
app.use("/text", authMiddleware);
app.use("/data/submissions.json", authMiddleware);
app.use("/admin/export", authMiddleware);

app.use(express.json());
app.use(express.static("public"));

const SUBMIT_PATH = path.join(__dirname, "public", "data", "submissions.json");

app.post("/api/verstuur", async (req, res) => {
  const { csv, onderwerp } = req.body;
  if (!csv || !onderwerp) return res.status(400).send("Ongeldige gegevens");

  const regels = csv.split("\n");
  if (regels.length >= 2) {
    const [_, inhoud] = regels;
    const delen = inhoud.split(",");
    const record = {
      Scheepsnaam: delen[0]?.replaceAll('"', ""),
      ETD: delen[1]?.replaceAll('"', ""),
      RedenGeenETD: delen[2]?.replaceAll('"', ""),
      Toelichting: delen[3]?.replaceAll('"', ""),
      Timestamp: delen[4]?.replaceAll('"', ""),
      Latitude: "",
      Longitude: ""
    };

    const schepen = getNearbyShips();
    const match = schepen.find(s => s.naam?.trim() === record.Scheepsnaam?.trim());
    if (match && match.track?.length > 0) {
      const laatste = match.track[match.track.length - 1];
      record.Latitude = laatste.lat;
      record.Longitude = laatste.lon;
    }

    let data = [];
    if (fs.existsSync(SUBMIT_PATH)) data = JSON.parse(fs.readFileSync(SUBMIT_PATH));
    data.push(record);
    fs.writeFileSync(SUBMIT_PATH, JSON.stringify(data, null, 2));

    const inhoudCSV = [
      "Scheepsnaam,ETD,RedenGeenETD,Toelichting,Timestamp,Latitude,Longitude",
      `"${record.Scheepsnaam}","${record.ETD}","${record.RedenGeenETD}","${record.Toelichting}","${record.Timestamp}","${record.Latitude}","${record.Longitude}"`
    ].join("\n");

    try {
      
      
      console.log("✅ Verzonden + Dropbox upload succesvol");
      res.json({ status: "ok" });
    } catch (err) {
      console.error("❌ Fout bij e-mail of Dropbox:", err);
      res.status(500).send("Verzending mislukt");
    }
  }
});

app.get("/api/ping", (req, res) => {
  res.send("✅ API actief");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("✅ Server draait op poort", PORT);
});


app.get("/api/schepen", (req, res) => {
  res.json(getNearbyShips());
});
