const WebSocket = require("ws");

let schepen = {}; // { MMSI: { naam, lat, lon } }

function afstandKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function isBinnen20Km(lat, lon) {
  return afstandKm(lat, lon, 51.95, 4.13) <= 20;
}

function startStream() {
  const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");

  ws.on("open", () => {
    console.log("WebSocket open");
    ws.send(JSON.stringify({ APIKey: process.env.AIS_API_KEY }));
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);
      const mmsi = msg.MMSI;

      if (msg.MessageType === "PositionReport" && msg.Position) {
        const { Latitude, Longitude } = msg.Position;
        if (isBinnen20Km(Latitude, Longitude)) {
          if (!schepen[mmsi]) schepen[mmsi] = {};
          schepen[mmsi].lat = Latitude;
          schepen[mmsi].lon = Longitude;
        }
      }

      if (msg.MessageType === "StaticDataReport" && msg.Name) {
        if (!schepen[mmsi]) schepen[mmsi] = {};
        schepen[mmsi].naam = msg.Name;
      }
    } catch (err) {
      console.error("Fout in berichtverwerking:", err);
    }
  });

  ws.on("error", (err) => console.error("WebSocket fout:", err));
  ws.on("close", () => {
    console.log("WebSocket gesloten, opnieuw verbinden over 5 sec...");
    setTimeout(startStream, 5000);
  });
}

function getNearbyShips() {
  return Object.values(schepen).filter(s => s.naam && s.lat && s.lon);
}

module.exports = { startStream, getNearbyShips };
