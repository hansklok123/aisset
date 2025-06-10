const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
let lastMessageTime = Date.now();
let timeoutIntervalId = null;
let aisTimeoutGemeld = false;

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
  33: "Bagger",
  34: "Duik-support",
  35: "Marine",
  36: "Zeiljacht",
  37: "Pleziervaartuig",
  40: "HSC",
  50: "Pilotvaartuig",
  51: "SAR",
  52: "Sleepboot",
  53: "Haven-autoriteit",
  54: "Anti-pollution",
  55: "Patrouillevaartuig",
  56: "Spare",
  57: "Spare",
  58: "Medisch Transport",
  59: "Marine",
  60: "Passagiersschip",
  61: "Passagiersschip",
  62: "Passagiersschip",
  63: "Passagiersschip",
  64: "Passagiersschip",
  65: "Passagiersschip",
  66: "Passagiersschip",
  67: "Passagiersschip",
  68: "Passagiersschip",
  69: "Passagiersschip",
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

// Laad schepenlijst uit bestand bij serverstart (indien aanwezig) EN fix type_naam direct!
if (fs.existsSync(DATA_PATH)) {
  try {
    schepen = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

    // FIX alle type_naam voor bestaande records op basis van het type-nummer:
    let gefixt = 0;
    for (const mmsi in schepen) {
      const schip = schepen[mmsi];
      const typeNum = Number(schip.type);
      const nieuweNaam = SHIP_TYPE_NAMES[typeNum] || "Onbekend";
      if (schip.type_naam !== nieuweNaam) {
        schip.type_naam = nieuweNaam;
        gefixt++;
      }
    }
    if (gefixt > 0) {
      fs.writeFileSync(DATA_PATH, JSON.stringify(schepen, null, 2));
      console.log(`✅ ${gefixt} bestaande records met type_naam bijgewerkt bij startup.`);
    }
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



// Controleer elke minuut of we nog data ontvangen
if (timeoutIntervalId) clearInterval(timeoutIntervalId);

timeoutIntervalId = setInterval(() => {
  const now = Date.now();
  if (now - lastMessageTime > 5 * 60 * 1000) {
    if (!aisTimeoutGemeld) {
      console.error("⚠️ Geen AIS-data ontvangen in 5 minuten. Verbinding wordt geforceerd gesloten.");
      aisTimeoutGemeld = true;
    }
    ws.terminate(); // Dit triggert reconnect via ws.on("close")
  } else {
    aisTimeoutGemeld = false; // reset zodra er weer data is
  }
}, 60 * 1000);



  ws.on("open", () => {
    const subscription = {
      APIKey: process.env.AIS_API_KEY,
      BoundingBoxes: [
        [[51.674, 3.61], [52.15, 4.70]] // volledige havengebied van Rotterdam
      ],
      FilterMessageTypes: ["PositionReport", "ShipStaticData"]
    };
    ws.send(JSON.stringify(subscription));
  });

  ws.on("message", (data) => {
    lastMessageTime = Date.now();

    try {
      const msg = JSON.parse(data);

      if (!["PositionReport", "ShipStaticData"].includes(msg.MessageType) || !msg.MetaData) return;

      const mmsi = msg.MetaData.MMSI;
      const { latitude, longitude, ShipName, Type, ShipType, VesselType, time_utc } = msg.MetaData;

      // ===== Type & lengte bepalen (ook ShipStaticData uit Message pakken) =====
      let shipType = "";
      let length = null;
      let draught = null;
      if (msg.MessageType === "ShipStaticData" && msg.Message && msg.Message.ShipStaticData) {
        shipType = msg.Message.ShipStaticData.Type || "";
        // Lengte berekenen uit dimension (A+B)
        if (msg.Message.ShipStaticData.Dimension) {
          length = (msg.Message.ShipStaticData.Dimension.A || 0) + (msg.Message.ShipStaticData.Dimension.B || 0);
        }
        if (msg.Message.ShipStaticData.MaximumStaticDraught != null) {
    draught = msg.Message.ShipStaticData.MaximumStaticDraught;
  }
      } else {
        shipType = Type || ShipType || VesselType || "";
      }

      const typeNum = Number(shipType);
      const typeNaam = SHIP_TYPE_NAMES[typeNum] || "Onbekend";

      // ====== Bijwerken schip ======
// ====== Nieuw: type alleen overschrijven als het een geldige waarde is ======

const bestaandType = schepen[mmsi]?.type ? Number(schepen[mmsi].type) : 0;
const nieuwTypeNum = Number(shipType);
const definitiefType = (nieuwTypeNum && nieuwTypeNum > 0) ? nieuwTypeNum : bestaandType;
const definitieveTypeNaam = SHIP_TYPE_NAMES[definitiefType] || "Onbekend";

if (!schepen[mmsi]) {
  schepen[mmsi] = {
    naam: ShipName || "",
    tijd: time_utc || "",
    type: definitiefType,
    type_naam: definitieveTypeNaam,
    lengte: length ? `${length} m` : null,
    draught: draught || null,             // <--- DIT TOEVOEGEN
    track: []
  };
} else {
  schepen[mmsi].naam = ShipName || schepen[mmsi].naam;
  schepen[mmsi].tijd = time_utc || schepen[mmsi].tijd;
  // Overschrijf type en type_naam alleen als er een geldige nieuwe waarde is!
  schepen[mmsi].type = definitiefType;
  schepen[mmsi].type_naam = definitieveTypeNaam;
  if (length) schepen[mmsi].lengte = length ? `${length} m` : schepen[mmsi].lengte;
  if (draught) schepen[mmsi].draught = draught;
}


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
