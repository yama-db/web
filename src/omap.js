// omap.js
import View from 'ol/View';
import {fromLonLat} from 'ol/proj';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import LayerGroup from 'ol/layer/Group';
import Map from 'ol/Map';
import Fill from 'ol/style/Fill';
import Stroke from 'ol/style/Stroke';
import Icon from 'ol/style/Icon';
import Text from 'ol/style/Text';
import Style from 'ol/style/Style';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import Zoom from 'ol/control/Zoom';
import ScaleLine from 'ol/control/ScaleLine';
import LayerSwitcher from 'ol-layerswitcher';
import Popup from 'ol-popup';

import CenterCross from './centercross.js';
import Searchbar from './searchbar.js';
import {fromStringYX} from './transangle.js';

const api_base = '/~tad/test/api/mountains/';

const param = {
  lon: 138.9853, lat: 36.5039, zoom: 10
};

let current_zoom;

const view = new View({
  center: fromLonLat([param.lon, param.lat]),
  zoom: param.zoom,
  minZoom: 2,
  maxZoom: 18,
  constrainResolution: true
});

const std = new TileLayer({
  source: new XYZ({
    attributions: '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>',
    url: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'
  }),
  title: '標準',
  type: 'base'
});

const pale = new TileLayer({
  source: new XYZ({
    attributions: '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>',
    url: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'
  }),
  title: '淡色',
  type: 'base',
  visible: false
});

const seamlessphoto = new TileLayer({
  source: new XYZ({
    attributions: '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>',
    url: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg'
  }),
  title: '写真',
  type: 'base',
  visible: false
});

const bases = new LayerGroup({
  layers: [seamlessphoto, pale, std],
  title: '地図の種類'
});

const zoom = new Zoom();
const scaleLine = new ScaleLine();
const centercross = new CenterCross({ element: document.getElementById('centercross') });
const searchbar = new Searchbar({ element: document.getElementById('searchbar') });

const map = new Map({
  target: 'map',
  layers: [bases],
  controls: [zoom, scaleLine, centercross, searchbar],
  view: view
});

const fill = new Fill({ color: 'blue' });
const stroke = new Stroke({ color: 'white', width: 2 });
const img_w = new Icon({ src: 'https://map.jpn.org/icon/902029.png', declutterMode: 'none' });
const img_r = new Icon({ src: 'https://map.jpn.org/icon/902030.png', declutterMode: 'none' });
const img_y = new Icon({ src: 'https://map.jpn.org/icon/902031.png', declutterMode: 'none' });
// zmin           8,     9,    10,    11,    12,    13
const img = [ img_r, img_r, img_r, img_r, img_y, img_w ];

function styleFunction(feature) {
  let style;
  const type = feature.getGeometry().getType();
  const zmin = feature.get('zmin');
  if (current_zoom < zmin) {
    return null;
  }
  if (type === 'Point') {
    style = {
      image: img[zmin - 8],
      text: new Text({
        text: feature.get('name'),
        font: '14px sans-serif',
        fill: fill,
        stroke: stroke,
        textAlign: 'left',
        offsetX: 12,
        offsetY: 3
      }),
      zIndex: feature.get('alt')
    };
  }
  return new Style(style);
}

const sanmei = new VectorLayer({
  source: new VectorSource({
    url: api_base + 'geojson',
    format: new GeoJSON()
  }),
  style: styleFunction,
  declutter: true
});

const data = new LayerGroup({
  layers: [sanmei],
  title: '山名'
});

map.addLayer(data);
map.addControl(new LayerSwitcher());

const result = document.getElementById('result');
document.getElementById('tb_result').addEventListener('click', function (_event) {
  result.style.display = result.style.display != 'none' ? 'none' : 'block';
});

const count = document.getElementById('count');
const items = document.getElementById('items');
let data_for_save = null;

function displayResults(data) {
  data_for_save = data;
  while (items.firstChild) {
    items.removeChild(items.firstChild);
  }
  count.textContent = data.length + '件';
  data.forEach(function (item) {
    const tr = document.createElement('tr'); // new row
    let td = document.createElement('td'); // 1st column
    td.textContent = item.id;
    td.addEventListener('click', function (_event) {
      const coordinate = fromLonLat([ item.lon, item.lat ]);
      view.setCenter(coordinate);
      if (view.getZoom() < 13) {
        view.setZoom(13);
      }
    });
    tr.appendChild(td);

    td = document.createElement('td'); // 2nd column
    const ruby = document.createElement('ruby');
    ruby.textContent = item.name;
    const rt = document.createElement('rt');
    rt.textContent = item.kana;
    tr.appendChild(td).appendChild(ruby).appendChild(rt);

    td = document.createElement('td'); // 3rd column
    td.textContent = item.alt;
    items.appendChild(tr).appendChild(td);
  });
}

async function query(s) {
  try {
    const response = await fetch(api_base + 'search?q=' + encodeURIComponent(s));
    if (!response.ok) {
      throw new Error(`HTTPエラー: ${response.status}`);
    }
    const data = await response.json();
    displayResults(data);
  } catch (error) {
    console.error('データの取得に失敗しました:', error);
  }
}

document.forms.form1.addEventListener('submit', function (event) {
  const s = event.target.elements.query.value;
  const lon_lat = fromStringYX(s);
  if (lon_lat) {
    view.setCenter(fromLonLat(lon_lat));
  } else {
    count.textContent = '検索中';
    result.style.display = 'block';
    query(s);
  }
  event.preventDefault();
});

document.forms.form2.addEventListener('submit', function (event) {
  const csv = (event.target.elements.bom.checked ? '\uFEFF' : '')
    + 'ID,山名,よみ,標高,緯度,経度,備考\n'
    + data_for_save.map(x => [ x.id, x.name, x.kana, x.alt, x.lat, x.lon, '' ].join()).join('\n')
    + '\n';
  const b = new Blob([ csv ], { type: 'text/csv;charset=UTF-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = 'result.csv';
  a.click();
  event.preventDefault();
});

function todms(deg) {
  const ss = Math.round(deg * 3600);
  const d = Math.floor(ss / 3600);
  const m = ('0' + Math.floor((ss % 3600) / 60)).substr(-2);
  const s = ('0' + ss % 60).substr(-2);
  return d + '°' + m + '′' + s + '″';
}

async function getMountainDetail(id) {
  try {
      const response = await fetch(api_base + id);
      if (!response.ok) {
          throw new Error(`HTTPエラー: ${response.status}`);
      }
      const data = await response.json();
      displayMountainInfo(data);
  } catch (error) {
      console.error('データの取得に失敗しました:', error);
  }
}

function displayMountainInfo(data) {
  const tbody = document.getElementById('mountain-info');
  tbody.innerHTML = '';
  const fields = [
    { label: 'よみ', value: data.names[0]['kana'] },
    { label: '別名', value: data.names.slice(1) },
    { label: '標高', value: data.alt + ' m' },
    { label: '点名', value: data.gcp_name },
    { label: '緯度', value: todms(data.lat) },
    { label: '経度', value: todms(data.lon) },
    { label: '所在', value: data.address.join('\n') },
    { label: '出典', value: data.auth },
    { label: 'ID', value: data.id }
  ];
  fields.forEach(function (field) {
    if (field.label === '別名' && field.value.length == 0) {
      return;
    }
    if (field.label === '点名' && !field.value) {
      return;
    }
    const tr = document.createElement('tr');
    const c1 = document.createElement('td');
    c1.textContent = field.label;
    const c2 = document.createElement('td');
    if (field.label === '別名') {
      field.value.forEach(function (item, index) {
        if (index > 0) {
          c2.appendChild(document.createElement('br'));
        }
        const ruby = document.createElement('ruby');
        ruby.textContent = item.name;
        const rt = document.createElement('rt');
        rt.textContent = item.kana;
        ruby.appendChild(rt);
        c2.appendChild(ruby);
      });
    } else {
      c2.textContent = field.value;
    }
    tr.appendChild(c1);
    tr.appendChild(c2);
    tbody.appendChild(tr);
  });
}

const popup = new Popup();

map.addOverlay(popup);

map.on('click', function (evt) {
  let coordinate;
  let html;
  map.forEachFeatureAtPixel(
    evt.pixel,
    function (feature, _layer) {
      const geometry = feature.getGeometry();
      if (geometry.getType() !== 'Point') {
        return false;
      }
      getMountainDetail(feature.getId());
      coordinate = geometry.getCoordinates();
      html = '<h2>' + feature.get('name')
        + '</h2><table><tbody id="mountain-info"></tbody></table>';
      return true;
    }
  );
  popup.show(coordinate, html);
});

map.on('pointermove', function (evt) {
  if (evt.dragging) { return; }
  const found = map.forEachFeatureAtPixel(
    map.getEventPixel(evt.originalEvent),
    function (feature, _layer) {
      return feature.getGeometry().getType() === 'Point';
    }
  );
  map.getTargetElement().style.cursor = found ? 'pointer' : '';
});

map.on('moveend', function (_evt) {
  current_zoom = view.getZoom();
  sanmei.changed();
});
