
const express = require("express");
const app = express();
const { startStream, getNearbyShips } = require("./aisstream");

startStream();
app.use(express.json());
app.use(express.static("public"));

app.get("/api/schepen", (req, res) => {
  res.json(getNearbyShips());
});

// NIEUW: Zoek op tijd en locatie (binnen 50m, tijd binnen ±15s)
app.post("/api/zoek", (req, res) => {
  const { tijd, lat, lon } = req.body;
  if (!tijd || typeof lat !== "number" || typeof lon !== "number") {
    return res.status(400).json({ naam: null });
  }

  const tijdInMs = new Date(tijd).getTime();
  const maxAfstandKm = 0.05; // 50 meter
  const maxTijdVerschil = 15 * 1000; // 15 seconden

  const schepen = getNearbyShips();
  for (const schip of schepen) {
    const track = schip.track || [];
    for (const punt of track) {
      const tijdpunt = new Date(punt.time || schip.tijd || "").getTime();
      const dLat = (punt.lat - lat) * Math.PI / 180;
      const dLon = (punt.lon - lon) * Math.PI / 180;
      const R = 6371;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat * Math.PI / 180) * Math.cos(punt.lat * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
      const afstand = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const tijdsverschil = Math.abs(tijdInMs - tijdpunt);

      if (afstand <= maxAfstandKm && tijdsverschil <= maxTijdVerschil) {
        return res.json({ naam: schip.naam || `MMSI: ${schip.mmsi}` });
      }
    }
  }

  res.json({ naam: null });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌍 Server draait op poort ${PORT}`);
});
