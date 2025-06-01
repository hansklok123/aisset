const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "public", "data", "schepen.json");

let schepen = {}; // { MMSI: { naam, tijd, type, type_naam, lengte, track: [{lat, lon, time}] } }

// Volledige AIS type mapping
const SHIP_TYPE_NAMES = {
  0: "Onbekend",
  20: "Wisselverkeer",
  21: "Wisselverkeer",
  22: "Wisselverkeer",
  23: "Wisselverkeer",
  24: "Wisselverkeer",
  25: "Wisselverkeer",
  26: "Wisselverkeer",
  27: "Wisselverkeer",
  28: "Wisselverkeer",
  29: "Wisselverkeer",
  30: "Vissersvaartuig",
  31: "Sleepboot",
  32: "Sleepduwcombinatie",
  33: "Passagiersschip",
  34: "Vrachtschip",
  35: "Tanker",
  36: "Pleziervaartuig",
  37: "Pleziervaartuig",
  40: "Hoogwaardig vaartuig",
  50: "Pilotvaartuig",
  51: "Sleepboot",
  52: "Vrachtschip (met gevaarlijke lading)",
  53: "Sleper",
  54: "Ontmijner",
  55: "Patrouillevaartuig",
  56: "Marineschip",
  57: "Zeilschip",
  58: "Pleziervaartuig",
  59: "Pleziervaartuig",
  60: "Passagiersschip",
  61: "Veerboot",
  62: "Cruiseschip",
  63: "Jacht",
  64: "Jacht",
  65: "Jacht",
  66: "Jacht",
  67: "Jacht",
  68: "Jacht",
  69: "Jacht",
  70: "Cargo schip",
  71: "Cargo schip - Hazard X",
  72: "Cargo schip - Hazard Y",
  73: "Cargo schip - Hazard Z",
  74: "Cargo schip - Hazard OS",
  75: "Cargo schip",
  76: "Cargo schip",
  77: "Cargo schip",
  78: "Cargo schip",
  79: "Cargo schip",
  80: "Tanker",
  81: "Tanker - Hazard A",
  82: "Tanker - Hazard B",
  83: "Tanker - Hazard C",
  84: "Tanker - LNG - Hazard D",
  85: "Tanker",
  86: "Tanker",
  87: "Tanker",
  88: "Tanker",
  89: "Tanker",
  90: "Overig",
  91: "Overig",
  92: "Overig",
  93: "Overig",
  94: "Overig",
  95: "Overig",
  96: "Overig",
  97: "Overig",
  98: "Overig",
  99: "NA"
};

// Laad schepenlijst uit bestand bij serverstart (indien aanwezig)
if (fs.existsSync(DATA_PATH)) {
  try {
    schepen = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  } catch (err) {
    console.error("❌ Fout bij laden van schepen.json:", err);
  }
}

// Sla schepenlijst op in bestand na elke wijziging
function saveSchepen() {
  try {
    const MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 uur
    const cutoff = Date.now() - MAX_AGE_MS;
    for (const mmsi in schepen) {
      const tijd = new Date(schepen[mmsi].tijd).getTime();
      if (tijd < cutoff) {
        delete schepen[mmsi];
      }
    }
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
      
      // ===== Type & lengte bepalen (ook ShipStaticData uit Message pakken) =====
      let shipType = "";
      let length = null;
      if (msg.MessageType === "ShipStaticData" && msg.Message && msg.Message.ShipStaticData) {
        shipType = msg.Message.ShipStaticData.Type || "";
        // Lengte berekenen uit dimension (A+B)
        if (msg.Message.ShipStaticData.Dimension) {
          length = (msg.Message.ShipStaticData.Dimension.A || 0) + (msg.Message.ShipStaticData.Dimension.B || 0);
        }
      } else {
        shipType = Type || ShipType || VesselType || "";
      }

      const typeNum = Number(shipType); // 👈 voeg deze regel toe!
      const typeNaam = SHIP_TYPE_NAMES[typeNum] || "Onbekend";

      // ====== Bijwerken schip ======
      if (!schepen[mmsi]) {
        schepen[mmsi] = {
          naam: ShipName || "",
          tijd: time_utc || "",
          type: shipType || "",
          type_naam: typeNaam,
          lengte: length ? `${length} m` : null,
          track: []
        };
      } else {
        schepen[mmsi].naam = ShipName || schepen[mmsi].naam;
        schepen[mmsi].tijd = time_utc || schepen[mmsi].tijd;
        if (length) schepen[mmsi].lengte = length ? `${length} m` : schepen[mmsi].lengte;
      }
      schepen[mmsi].type = shipType || schepen[mmsi].type;
      schepen[mmsi].type_naam = typeNaam;

      // Alleen positie toevoegen als die aanwezig is
      if (latitude && longitude) {
        const track = schepen[mmsi].track;
        const laatste = track[track.length - 1];
        if (!laatste || laatste.lat !== latitude || laatste.lon !== longitude) {
          track.push({ lat: latitude, lon: longitude, time: time_utc });
          while (track.length > 2) track.shift();
        }
      }

      saveSchepen();

    } catch (err) {
      console.error("❌ Fout bij verwerken bericht:", err);
    }
  });

  ws.on("error", (err) => console.error("❌ WebSocket fout:", err));
  ws.on("close", () => {
    console.error("⚠️ WebSocket gesloten, opnieuw verbinden over 5 sec...");
    setTimeout(startStream, 5000);
  });
}

function getNearbyShips() {
  return Object.entries(schepen).map(([mmsi, schip]) => ({ mmsi, ...schip }));
}

module.exports = { startStream, getNearbyShips };
