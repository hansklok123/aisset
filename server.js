const express = require("express");
const path = require("path");
const { startStream, getNearbyShips } = require("./aisstream");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

startStream();

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/schepen", (req, res) => {
  res.json(getNearbyShips());
});

app.listen(PORT, () => {
  console.log(`Server draait op poort ${PORT}`);
});
