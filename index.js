
const express = require("express");
const fs = require("fs");
const path = require("path");
const session = require("express-session");
const nodemailer = require("nodemailer");
const { startStream, getNearbyShips } = require("./aisstream");

startStream();
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const SUBMIT_PATH = path.join(__dirname, "data", "submissions.json");

// AUTH middleware

// INLOGROUTE

});


  if (gebruikersnaam === "LVW" && wachtwoord === "MMP14") {
    req.session.ingelogd = true;
    return res.redirect("/admin");
  }
  res.send("<p>Ongeldige gegevens. <a href='/admin/login'>Probeer opnieuw</a></p>");
});


  });
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "private", "admin.html"));
});

app.get("/admin/data", (req, res) => {
  if (fs.existsSync(SUBMIT_PATH)) {
    const data = JSON.parse(fs.readFileSync(SUBMIT_PATH));
    res.json(data);
  } else {
    res.json([]);
  }
});

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

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS
      }
    });

    try {
      await transporter.sendMail({
        from: \`ETD Formulier <\${process.env.GMAIL_USER}>\`,
        to: "shipsetd@gmail.com",
        subject: onderwerp,
        text: "Bijgevoegd het ETD-formulier.",
        attachments: [{ filename: "etd.csv", content: inhoudCSV }]
      });

      console.log("✅ Mail verzonden");
      res.send("Verzonden");
    } catch (err) {
      console.error("❌ MAIL FOUT:", err);
      res.status(500).send("Mailfout");
    }
  }
});

app.get("/api/schepen", (req, res) => {
  res.json(getNearbyShips());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("✅ Server draait op poort", PORT);
});
