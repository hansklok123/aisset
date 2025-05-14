const express = require("express");
const basicAuth = require("express-basic-auth");
const fs = require("fs");
const nodemailer = require("nodemailer");
const path = require("path");
const { startStream, getNearbyShips } = require("./aisstream");

startStream();
const app = express();
app.use(express.json());
app.use(express.static("public"));

const CSV_PAD = path.join(__dirname, "data", "submissions.json");

app.get("/api/schepen", (req, res) => {
  res.json(getNearbyShips());
});

app.post("/api/verstuur", async (req, res) => {
  const { csv, onderwerp } = req.body;
  if (!csv || !onderwerp) return res.status(400).send("Incompleet verzoek");

  const timestamp = new Date().toISOString();
  const regels = csv.split("\n");
  if (regels.length >= 2) {
    const [_, waarden] = regels;
    const delen = waarden.split(",");
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
    const schip = schepen.find(s => s.naam?.trim() === record.Scheepsnaam?.trim());
    if (schip && schip.track?.length > 0) {
      const laatste = schip.track[schip.track.length - 1];
      record.Latitude = laatste.lat;
      record.Longitude = laatste.lon;
    }

    let data = [];
    if (fs.existsSync(CSV_PAD)) {
      data = JSON.parse(fs.readFileSync(CSV_PAD));
    }
    data.push(record);
    fs.writeFileSync(CSV_PAD, JSON.stringify(data, null, 2));

    const csvOutput = [
      "Scheepsnaam,ETD,RedenGeenETD,Toelichting,Timestamp,Latitude,Longitude",
      `"${record.Scheepsnaam}","${record.ETD}","${record.RedenGeenETD}","${record.Toelichting}","${record.Timestamp}","${record.Latitude}","${record.Longitude}"`
    ].join("\n");

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS
      }
    });

    try {
      await transporter.sendMail({
        from: `"Loodswezen ETD" <${process.env.GMAIL_USER}>`,
        to: "shipsetd@gmail.com",
        subject: onderwerp,
        text: "Bijgevoegd het ETD-formulier.",
        attachments: [{
          filename: "etd-registratie.csv",
          content: csvOutput
        }]
      });

      console.log("✅ Mail verzonden");
      res.send("Mail verzonden");
    } catch (err) {
      console.error("❌ Mailfout:", err);
      res.status(500).send("Fout bij versturen");
    }
  } else {
    res.status(400).send("Onvolledige CSV-inhoud");
  }
});

// Beveiligde adminomgeving
app.use("/admin", basicAuth({
  users: { "LVW": "MMP14" },
  challenge: true,
}));

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "private", "admin.html"));
});

app.get("/admin/data", (req, res) => {
  const data = fs.existsSync(CSV_PAD) ? JSON.parse(fs.readFileSync(CSV_PAD)) : [];
  res.json(data);
});

app.get("/admin/export", (req, res) => {
  const data = fs.existsSync(CSV_PAD) ? JSON.parse(fs.readFileSync(CSV_PAD)) : [];
  const type = req.query.type;

  if (type === "csv") {
    const csv = [
      "Scheepsnaam,ETD,RedenGeenETD,Toelichting,Timestamp,Latitude,Longitude",
      ...data.map(d =>
        [d.Scheepsnaam, d.ETD, d.RedenGeenETD, d.Toelichting, d.Timestamp, d.Latitude, d.Longitude]
          .map(v => `"${v}"`).join(","))
    ].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.send(csv);
  } else if (type === "xml") {
    const xml = "<?xml version=\"1.0\"?><ETDRegistraties>" + data.map(d =>
      `<ETD><Scheepsnaam>${d.Scheepsnaam}</Scheepsnaam><ETD>${d.ETD}</ETD><RedenGeenETD>${d.RedenGeenETD}</RedenGeenETD><Toelichting>${d.Toelichting}</Toelichting><Timestamp>${d.Timestamp}</Timestamp><Latitude>${d.Latitude}</Latitude><Longitude>${d.Longitude}</Longitude></ETD>`
    ).join("") + "</ETDRegistraties>";
    res.setHeader("Content-Type", "application/xml");
    res.send(xml);
  } else {
    res.status(400).send("Onbekend formaat");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌍 Server draait op poort ${PORT}`);
});
