const WebSocket = require("ws");

let schepen = {}; // { MMSI: { naam, lat, lon } }

function afstandKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isBinnenBereik(lat, lon) {
  return afstandKm(lat, lon, 51.95, 4.13) <= 50; // vergroot tot 50 km
}

function startStream() {
  const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");

  ws.on("open", () => {
    console.log("✅ WebSocket verbinding geopend");

    const subscription = {
      APIKey: process.env.AIS_API_KEY,
      BoundingBoxes: [[[51.0, 3.0], [52.5, 5.5]]],
      FilterMessageTypes: ["PositionReport", "StaticDataReport"]
    };

    ws.send(JSON.stringify(subscription));
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);

      if (!msg.MessageType || !msg.MetaData) return;

      const mmsi = msg.MetaData.MMSI;

      if (msg.MessageType === "PositionReport" &&
          msg.MetaData.Latitude &&
          msg.MetaData.Longitude) {

        const { Latitude, Longitude } = msg.MetaData;

        if (isBinnenBereik(Latitude, Longitude)) {
          if (!schepen[mmsi]) schepen[mmsi] = {};
          schepen[mmsi].lat = Latitude;
          schepen[mmsi].lon = Longitude;

          console.log(`📍 Positie: ${mmsi} (${Latitude.toFixed(4)}, ${Longitude.toFixed(4)})`);
        }
      }

      if (msg.MessageType === "StaticDataReport" && msg.MetaData.ShipName) {
        if (!schepen[mmsi]) schepen[mmsi] = {};
        schepen[mmsi].naam = msg.MetaData.ShipName;

        console.log(`🛳️ Naam: ${mmsi} – ${msg.MetaData.ShipName}`);
      }
    } catch (err) {
      console.error("❌ Fout bij verwerken bericht:", err);
    }
  });

  ws.on("error", (err) => console.error("❌ WebSocket fout:", err));
  ws.on("close", () => {
    console.log("⚠️ WebSocket gesloten, opnieuw verbinden over 5 sec...");
    setTimeout(startStream, 5000);
  });
}

function getNearbyShips() {
  return Object.values(schepen).filter(s => s.naam && s.lat && s.lon);
}

module.exports = { startStream, getNearbyShips };
