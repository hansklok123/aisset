const WebSocket = require("ws");

let schepen = {}; // { MMSI: { lat, lon, naam } }

function afstandKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const targetLat = 51.966775344428456;
const targetLon = 4.112534920608608;

function isBinnenBereik(lat, lon) {
  return afstandKm(lat, lon, targetLat, targetLon) <= 0.5;
}

function startStream() {
  const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");

  ws.on("open", () => {
    console.log("✅ WebSocket verbinding geopend");

    const subscription = {
      APIKey: process.env.AIS_API_KEY,
      BoundingBoxes: [[[51.94, 4.08], [52.00, 4.16]]],
      FilterMessageTypes: ["PositionReport"]
    };

    ws.send(JSON.stringify(subscription));
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.MessageType !== "PositionReport" || !msg.MetaData) return;

      const mmsi = msg.MetaData.MMSI;
      const { latitude, longitude, ShipName } = msg.MetaData;

      if (latitude && longitude && isBinnenBereik(latitude, longitude)) {
        schepen[mmsi] = {
          lat: latitude,
          lon: longitude,
          naam: ShipName || "",
        };
        console.log(`📍 BINNEN 500m: ${mmsi} (${latitude.toFixed(5)}, ${longitude.toFixed(5)}) – ${ShipName || "?"}`);
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
  const alles = Object.entries(schepen);
  console.log(`🧪 Schepen binnen 500m: ${alles.length}`);
  return alles.map(([mmsi, schip]) => ({ mmsi, ...schip }));
}

module.exports = { startStream, getNearbyShips };
