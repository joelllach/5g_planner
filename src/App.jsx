
import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';
import './index.css';

function TowerEditor({ towers, setTowers }) {
  useMapEvents({
    click(e) {
      setTowers([...towers, { id: Date.now(), lat: e.latlng.lat, lng: e.latlng.lng }]);
    }
  });

  return (
    <>
      {towers.map(tower => (
        <Marker
          key={tower.id}
          position={[tower.lat, tower.lng]}
          draggable={true}
          eventHandlers={{
            dragend(e) {
              const newPos = e.target.getLatLng();
              setTowers(towers.map(t => t.id === tower.id ? { ...t, lat: newPos.lat, lng: newPos.lng } : t));
            },
            contextmenu() {
              setTowers(towers.filter(t => t.id !== tower.id));
            }
          }}
        />
      ))}
    </>
  );
}

function RecenterMap({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView(center, 18);
  }, [center]);
  return null;
}

function HDOPOverlay({ data, type }) {
  const map = useMap();
  const layerRef = useRef();

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
    }
    if (!data.length) return;

    if (type === 'heatmap') {
      const heatData = data.map(p => [p.lat, p.lng, 1 / p.hdop]);
      const layer = L.heatLayer(heatData, { radius: 15, blur: 25 });
      layer.addTo(map);
      layerRef.current = layer;
    } else if (type === 'pixel_grid') {
      const group = L.layerGroup();
      data.forEach(p => {
        const color = `rgba(0, 0, 255, ${Math.min(1, 1 / p.hdop)})`;
        const rect = L.rectangle([
          [p.lat - p.res / 2, p.lng - p.res / 2],
          [p.lat + p.res / 2, p.lng + p.res / 2]
        ], { color, weight: 0, fillOpacity: 0.6 });
        rect.addTo(group);
      });
      group.addTo(map);
      layerRef.current = group;
    }
  }, [data, type]);

  return null;
}

function generateGrid(towers, res = 0.0005) {
  const results = [];
  if (towers.length < 3) return [];

  let latMin = 90, latMax = -90, lngMin = 180, lngMax = -180;
  towers.forEach(t => {
    latMin = Math.min(latMin, t.lat);
    latMax = Math.max(latMax, t.lat);
    lngMin = Math.min(lngMin, t.lng);
    lngMax = Math.max(lngMax, t.lng);
  });

  for (let lat = latMin; lat <= latMax; lat += res) {
    for (let lng = lngMin; lng <= lngMax; lng += res) {
      const hdop = computeHdop(lat, lng, towers);
      results.push({ lat, lng, hdop, res });
    }
  }

  return results;
}

function computeHdop(lat, lng, towers) {
  if (towers.length < 3) return 100;
  const A = towers.map(t => {
    const dx = t.lng - lng;
    const dy = t.lat - lat;
    const norm = Math.sqrt(dx * dx + dy * dy);
    return [dx / norm, dy / norm];
  });
  const G = mathMultiply(mathTranspose(A), A);
  const det = G[0][0] * G[1][1] - G[0][1] * G[1][0];
  if (det === 0) return 100;
  const inv = [
    [ G[1][1] / det, -G[0][1] / det],
    [-G[1][0] / det,  G[0][0] / det]
  ];
  return Math.sqrt(inv[0][0] + inv[1][1]);
}

function mathTranspose(m) {
  return m[0].map((_, i) => m.map(row => row[i]));
}

function mathMultiply(a, b) {
  return a.map(row => b[0].map((_, j) => row.reduce((sum, v, i) => sum + v * b[i][j], 0)));
}

function findTowerClusterCenter(towers, distanceThreshold = 0.3) {
  if (towers.length === 0) return null;
  const toRad = deg => deg * Math.PI / 180;
  const earthRadiusKm = 6371;
  function haversine(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lat2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  const groups = [];
  for (let i = 0; i < towers.length; i++) {
    const base = towers[i];
    let found = false;
    for (const group of groups) {
      if (group.some(t => haversine(t.lat, t.lng, base.lat, base.lng) < distanceThreshold)) {
        group.push(base);
        found = true;
        break;
      }
    }
    if (!found) groups.push([base]);
  }
  const largest = groups.reduce((a, b) => (a.length > b.length ? a : b), []);
  const avgLat = largest.reduce((sum, t) => sum + t.lat, 0) / largest.length;
  const avgLng = largest.reduce((sum, t) => sum + t.lng, 0) / largest.length;
  return [avgLat, avgLng];
}

export default function App() {
  const [tab, setTab] = useState('planner');
  const [towers, setTowers] = useState([]);
  const [precision, setPrecision] = useState(0.001);
  const [mapCenter, setMapCenter] = useState([37.7749, -122.4194]);
  const [overlayType, setOverlayType] = useState("heatmap");
  const [gridData, setGridData] = useState([]);

  const handleFileUpload = (e) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (Array.isArray(parsed)) {
          setTowers(parsed);
          const cluster = findTowerClusterCenter(parsed);
          if (cluster) setMapCenter(cluster);
          setGridData(generateGrid(parsed, precision));
        } else if (parsed.towers && parsed.precision) {
          setTowers(parsed.towers);
          setPrecision(parsed.precision);
          const cluster = findTowerClusterCenter(parsed.towers);
          if (cluster) setMapCenter(cluster);
          setGridData(generateGrid(parsed.towers, parsed.precision));
        } else {
          alert("Invalid file format");
        }
      } catch {
        alert('Invalid JSON');
      }
    };
    reader.readAsText(e.target.files[0]);
  };

  useEffect(() => {
    if (towers.length > 2 && tab === 'analysis') {
      setGridData(generateGrid(towers, precision));
    }
  }, [precision, overlayType]);

  return (
    <div className="p-4 space-y-4">
      <div className="space-x-2">
        <button onClick={() => setTab('planner')} className={`px-4 py-2 ${tab === 'planner' ? 'bg-blue-600 text-white' : 'bg-gray-300'}`}>Place Towers</button>
        <button onClick={() => setTab('analysis')} className={`px-4 py-2 ${tab === 'analysis' ? 'bg-blue-600 text-white' : 'bg-gray-300'}`}>Analyze Coverage</button>
      </div>

      {tab === 'planner' && (
        <div className="space-y-4">
          <input type="file" onChange={handleFileUpload} className="block" />
          <MapContainer center={mapCenter} zoom={18} className="h-[600px] w-full">
            <RecenterMap center={mapCenter} />
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <TowerEditor towers={towers} setTowers={setTowers} />
          </MapContainer>
          <button
            onClick={() => {
              const output = { towers, precision };
              const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(output, null, 2));
              const dl = document.createElement('a');
              dl.setAttribute("href", dataStr);
              dl.setAttribute("download", "towers.json");
              dl.click();
            }}
            className="bg-blue-600 text-white px-4 py-2 rounded"
          >
            Save Towers to JSON
          </button>
        </div>
      )}

      {tab === 'analysis' && (
        <div className="space-y-4">
          <input type="file" onChange={handleFileUpload} className="block" />
          <label>Overlay Type</label>
          <select value={overlayType} onChange={e => setOverlayType(e.target.value)} className="block border px-2 py-1">
            <option value="heatmap">Heatmap</option>
            <option value="pixel_grid">Pixel Grid</option>
          </select>
          <label>Grid Precision:</label>
          <select
            value={precision}
            onChange={e => setPrecision(parseFloat(e.target.value))}
            className="block border px-2 py-1"
          >
            <option value={0.01}>~1 km (.01)</option>
            <option value={0.001}>~100 m (.001)</option>
            <option value={0.0001}>~10 m (.0001)</option>
            <option value={0.00001}>~1 m (.00001)</option>
          </select>
          <MapContainer center={mapCenter} zoom={18} className="h-[600px] w-full">
            <RecenterMap center={mapCenter} />
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {towers.map(t => (
              <Marker key={t.id} position={[t.lat, t.lng]} icon={L.divIcon({ html: '📡', className: 'text-xl' })} />
            ))}
            <HDOPOverlay data={gridData} type={overlayType} />
          </MapContainer>
        </div>
      )}
    </div>
  );
}
