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


      console.error("❌ Fout bij e-mail of Dropbox:", err);
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


const laatsteInzending = {}; // timestamp per schip



const laatsteInzending = {};

app.post("/api/verstuur", async (req, res) => {
  const { csv, onderwerp } = req.body;

  try {
    const regels = csv.trim().split("\n");
    if (regels.length < 2) {
      return res.status(400).send("Ongeldig CSV-formaat");
    }

    const gegevens = regels[1].split(",");
    const scheepsnaam = gegevens[0];
    const timestamp = new Date(gegevens[4]).getTime();

    // Dubbele bescherming: binnen 3 seconden voor zelfde schip
    if (
      laatsteInzending[scheepsnaam] &&
      Math.abs(timestamp - laatsteInzending[scheepsnaam]) < 3000
    ) {
      console.log(`⛔ Dubbele inzending voor ${scheepsnaam} genegeerd`);
      return res.status(200).send("Dubbele inzending genegeerd");
    }

    laatsteInzending[scheepsnaam] = timestamp;

    // Verwerking (placeholder)
    console.log("✅ Inzending verwerkt voor:", scheepsnaam);
    res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Fout bij verwerken:", err);
    res.status(500).send("Verwerkingsfout");
  }
});
