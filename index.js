
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
      Timestamp: delen[5]?.replaceAll('"', ""),
      Latitude: delen[6]?.replaceAll('"', ""),
      Longitude: delen[7]?.replaceAll('"', "")
    };
    // Voeg record toe aan je database of schrijf naar file
    res.json({ ok: true, ontvangen: record });
  } else {
    res.status(400).send("Ongeldige CSV");
  }
});
