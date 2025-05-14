const WebSocket = require("ws");

let schepen = {}; // { MMSI: { naam, tijd, track: [ { lat, lon } ] } }

function afstandKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
      console.log("📦 Volledig bericht ontvangen:");
      console.log(JSON.stringify(msg, null, 2));

      if (msg.MessageType !== "PositionReport" || !msg.MetaData) return;

      const mmsi = msg.MetaData.MMSI;
      const { latitude, longitude, ShipName, time_utc } = msg.MetaData;

      if (latitude && longitude) {
        if (!schepen[mmsi]) {
          schepen[mmsi] = {
            naam: ShipName || "",
            tijd: time_utc || "",
            track: [{ lat: latitude, lon: longitude }]
          };
        } else {
          schepen[mmsi].naam = ShipName || schepen[mmsi].naam;
          schepen[mmsi].tijd = time_utc || schepen[mmsi].tijd;
          const track = schepen[mmsi].track;
          const laatste = track[track.length - 1];
          if (!laatste || laatste.lat !== latitude || laatste.lon !== longitude) {
            track.push({ lat: latitude, lon: longitude });
            if (track.length > 20) track.shift(); // max 20 punten
          }
        }
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
  return Object.entries(schepen).map(([mmsi, schip]) => ({ mmsi, ...schip }));
}

module.exports = { startStream, getNearbyShips };
