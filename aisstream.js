const WebSocket = require("ws");

let schepen = {}; // { MMSI: { lat, lon } }

function afstandKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Nieuw referentiepunt: 1 km rond deze coördinaten
const targetLat = 51.969363314568625;
const targetLon = 4.123386665628428;

function isBinnenBereik(lat, lon) {
  return afstandKm(lat, lon, targetLat, targetLon) <= 1;
}

function startStream() {
  const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");

  ws.on("open", () => {
    console.log("✅ WebSocket verbinding geopend");

    const subscription = {
      APIKey: process.env.AIS_API_KEY,
      BoundingBoxes: [[[51.94, 4.08], [52.00, 4.16]]],
      FilterMessageTypes: [
        "PositionReport",
        "StaticDataReport",
        "BaseStationReport",
        "SafetyBroadcastMessage",
        "AddressedSafetyMessage",
        "AidsToNavigationReport",
        "ShipStaticData",
        "StandardClassBPositionReport",
        "ExtendedClassBPositionReport",
        "Interrogation",
        "BinaryBroadcastMessage",
        "BinaryAcknowledge",
        "DataLinkManagementMessage",
        "GroupAssignmentCommand",
        "ChannelManagement",
        "LongRangeAisBroadcastMessage",
        "AssignedModeCommand"
      ]
    };

    ws.send(JSON.stringify(subscription));
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);
      if (!msg.MessageType || !msg.MetaData) return;

      const mmsi = msg.MetaData.MMSI;
      const messageType = msg.MessageType;
      console.log(`📩 ${messageType} ontvangen voor MMSI ${mmsi}`);
      console.log("📦 Berichtinhoud:", JSON.stringify(msg, null, 2));

      if (msg.MetaData.Latitude && msg.MetaData.Longitude) {
        const { Latitude, Longitude } = msg.MetaData;
        if (isBinnenBereik(Latitude, Longitude)) {
          schepen[mmsi] = { lat: Latitude, lon: Longitude };
          console.log(`📍 BINNEN 1 KM: ${mmsi} (${Latitude.toFixed(5)}, ${Longitude.toFixed(5)})`);
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
  const alles = Object.entries(schepen);
  console.log(`🧪 Aantal schepen binnen 1 km: ${alles.length}`);
  return alles.map(([mmsi, schip]) => ({ mmsi, ...schip }));
}

module.exports = { startStream, getNearbyShips };
