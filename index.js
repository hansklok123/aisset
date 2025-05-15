
const express = require('express');
const basicAuth = require('express-basic-auth');
const app = express();

// AUTHENTICATIE
const authMiddleware = basicAuth({
  users: { 'admin': 'wachtwoord123' },
  challenge: true,
  realm: 'Beveiligd gebied'
});

// BEVEILIGDE ROUTES
app.use("/admin", authMiddleware);
app.use("/text", authMiddleware);
app.use("/data/submissions.json", authMiddleware);
app.use("/admin/export", authMiddleware);

// VOORBEELD OPEN API'S
app.use(express.json());

app.get("/api/schepen", (req, res) => {
  res.json([{ naam: "Voorbeeldschip", mmsi: "123456789", tijd: "2025-05-15T10:00:00Z", track: [{ lat: 51.9, lon: 4.1 }] }]);
});

app.post("/api/verstuur", (req, res) => {
  console.log("ETD ontvangen:", req.body);
  res.sendStatus(200);
});

app.listen(3000, () => console.log("Server draait op http://localhost:3000"));
