
const express = require("express");
const app = express();
const { startStream, getNearbyShips } = require("./aisstream");
const nodemailer = require("nodemailer");

startStream();
app.use(express.json());
app.use(express.static("public"));

app.get("/api/schepen", (req, res) => {
  res.json(getNearbyShips());
});

// E-mail CSV naar vaste ontvanger
app.post("/api/verstuur", async (req, res) => {
  const { csv, onderwerp } = req.body;
  if (!csv || !onderwerp) return res.status(400).send("Incompleet verzoek");

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS
    }
  });

  try {
    await transporter.sendMail({
      from: '"AIS ETD via Gmail" <${process.env.GMAIL_USER}>',
      to: "tilij47053@hazhab.com",
      subject: onderwerp,
      text: "Zie bijlage met ETD-registratie.",
      attachments: [{
        filename: "etd-registratie.csv",
        content: csv
      }]
    });

    console.log("✅ Mail verzonden");
    res.send("Mail verzonden");
  } catch (err) {
    console.error("❌ Mailfout:", err);
    res.status(500).send("Fout bij versturen");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌍 Server draait op poort ${PORT}`);
});
