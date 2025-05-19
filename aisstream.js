const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "public", "data", "schepen.json");

let schepen = {}; // { MMSI: { naam, tijd, type, track: [{lat, lon, time}] } }

// Laad schepenlijst uit bestand bij serverstart (indien aanwezig)
if (fs.existsSync(DATA_PATH)) {
  try {
    schepen = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    console.log(`🚢 ${Object.keys(schepen).length} schepen geladen uit bestand.`);
  } catch (err) {
    console.error("❌ Fout bij laden van schepen.json:", err);
  }
}

// Sla schepenlijst op in bestand na elke wijziging
function saveSchepen() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(schepen, null, 2));
  } catch (err) {
    console.error("❌ Fout bij opslaan van schepen.json:", err);
  }
}

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
      BoundingBoxes: [
        [[51.674, 3.61], [52.05, 4.65]] // volledige havengebied van Rotterdam
      ],
      FilterMessageTypes: ["PositionReport", "ShipStaticData"]
    };

    ws.send(JSON.stringify(subscription));
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);
      if (!["PositionReport", "ShipStaticData"].includes(msg.MessageType) || !msg.MetaData) return;

      const mmsi = msg.MetaData.MMSI;
      const { latitude, longitude, ShipName, Type, ShipType, VesselType, time_utc } = msg.MetaData;
      const shipType = Type || ShipType || VesselType || "";

      if (latitude && longitude) {
        if (!schepen[mmsi]) {
          schepen[mmsi] = {
            naam: ShipName || "",
            tijd: time_utc || "",
            type: shipType || "",
            track: [{ lat: latitude, lon: longitude, time: time_utc }]
          };
          saveSchepen();
        } else {
          schepen[mmsi].naam = ShipName || schepen[mmsi].naam;
          schepen[mmsi].tijd = time_utc || schepen[mmsi].tijd;
          schepen[mmsi].type = shipType || schepen[mmsi].type;
          const track = schepen[mmsi].track;
          const laatste = track[track.length - 1];
          if (!laatste || laatste.lat !== latitude || laatste.lon !== longitude) {
            track.push({ lat: latitude, lon: longitude, time: time_utc });
            if (track.length > 20) track.shift();
          }
          saveSchepen();
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
